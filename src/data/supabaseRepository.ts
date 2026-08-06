/**
 * التنفيذ فوق Supabase — the Supabase-backed implementation of the same
 * repository contract. لا صفحة تتغيّر: نفس الواجهة بالحرف.
 *
 * القراءة تتم بمفتاح النشر (anon) ولذلك تمرّ كلها عبر RLS:
 *   * `products` و`product_variants` و`perfume_catalog` مقروءة للجميع
 *     (سياسات `*_read_all` في 0002_rls.sql) — فهذه بيانات حيّة فعلاً.
 *   * كل ما يخص الطلب (customers, carts, cart_items, custom_perfume_requests,
 *     orders, order_items, production_queue, shipments, staging_outbox) ممنوع
 *     على anon: لا منحة ولا سياسة. يحتاج جلسة مُوثَّقة، ومعظمه يحتاج admin.
 *
 * لذلك يأخذ هذا التنفيذ `sessionScopedFallback`: حين لا توجد جلسة، مسار الطلب
 * يعمل على المخزن المحلي كما كان بالضبط، بدل أن يعيد قائمة فارغة صامتة أو
 * يرمي خطأ RLS في وجه العميل. هذا القرار مكتوب هنا صراحةً لا مخبّأ في شرط.
 *
 * Reads use the publishable (anon) key and therefore go through RLS. The public
 * shelf is genuinely live. Everything order-shaped requires an authenticated
 * session under 0002_rls.sql, so when there is no session the order lifecycle
 * is served by the explicitly injected local fallback — never silently empty.
 */
import type { PaymentStatus, ProductionStatus, ShippingStatus, StructuredAddress } from "@/config/customOrderContract";
import type { CustomOil, Product } from "@/data/mock";
import type { Order, OrderDraft, OrderLine, RazeenRepository } from "@/data/repositoryContract";
import { isProductionEligible } from "@/data/repositoryContract";
import { lineTotalFils, readyMadePriceFils } from "@/lib/pricing";
import type { SupabaseClient } from "@supabase/supabase-js";

const FILS_PER_AED = 100;
/** الفلس هو وحدة الحساب في التطبيق كما في القاعدة — لا تحويل ولا تقريب للمال. */
const toAed = (fils: number): number => Math.round(fils / FILS_PER_AED);

/** PostgREST يعيد العلاقة الواحدة ككائن أو كمصفوفة حسب استنتاجه. نطبّعها. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`Supabase ${context}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// صفوف قاعدة البيانات — الأسماء كما في 0001_baseline.sql حرفياً.
// ---------------------------------------------------------------------------
interface ProductRow {
  handle: string; title_ar: string; title_en: string | null;
  family: Product["family"] | null; intensity: 1 | 2 | 3 | null;
  base_price_fils: number; currency: string; is_available: boolean; is_vip: boolean;
  aliases: string[] | null;
  product_variants?: Array<{ stock_qty: number; is_active: boolean; price_fils: number | null }>;
}

interface CatalogRow {
  code: string; inspired_brand: string; perfume_name: string; kilo_price_fils: number;
}

export interface ProductVariantRow {
  id: string; product_id: string; sku: string; bottle_size: string;
  price_fils: number; stock_qty: number; is_active: boolean;
}
export interface CustomPerfumeRequestRow {
  id: string; customer_id: string; catalog_id: string | null; free_text_request: string | null;
  bottle_size: string; quantity: number; quoted_price_fils: number; status: string;
  customer_notes: string | null; created_at: string;
}
export interface CartRow { id: string; customer_id: string | null; session_token: string | null; status: string; created_at: string; }
export interface CartItemRow {
  id: string; cart_id: string; variant_id: string | null; custom_request_id: string | null;
  quantity: number; unit_price_fils: number;
}
export interface ShipmentRow {
  id: string; order_id: string; carrier: string; tracking_number: string | null;
  status: string; shipped_at: string | null; delivered_at: string | null;
}
export interface StagingOutboxRow {
  id: string; channel: string; recipient: string; subject: string | null; body: string;
  related_entity: string | null; related_entity_id: string | null; would_have_sent_at: string;
}

interface OrderRow {
  id: string; order_number: string; status: string; payment_status: string;
  subtotal_fils: number; shipping_fils: number; discount_fils: number; total_fils: number; currency: string;
  shipping_address: Partial<StructuredAddress> | null;
  placed_at: string; created_at: string;
  customers: { full_name: string; phone: string; emirate: string | null; area: string | null;
    street: string | null; building: string | null; flat: string | null } | null;
  order_items: Array<{
    id: string; variant_id: string | null; custom_request_id: string | null;
    title_snapshot: string; quantity: number; unit_price_fils: number; line_total_fils: number;
    product_variants: { sku: string; bottle_size: string } | null;
    custom_perfume_requests: { bottle_size: string; customer_notes: string | null;
      perfume_catalog: { code: string } | null } | null;
  }> | null;
  production_queue: { status: string } | { status: string }[] | null;
  shipments: Array<{ status: string; tracking_number: string | null }> | null;
}

const ORDER_SELECT = `
  id, order_number, status, payment_status, subtotal_fils, shipping_fils, discount_fils, total_fils,
  currency, shipping_address, placed_at, created_at,
  customers ( full_name, phone, emirate, area, street, building, flat ),
  order_items (
    id, variant_id, custom_request_id, title_snapshot, quantity, unit_price_fils, line_total_fils,
    product_variants ( sku, bottle_size ),
    custom_perfume_requests ( bottle_size, customer_notes, perfume_catalog ( code ) )
  ),
  production_queue ( status ),
  shipments ( status, tracking_number )
`;

// ---------------------------------------------------------------------------
// ترجمة الحالات. جدول واحد مكتوب، بلا اجتهاد في مواضع الاستدعاء.
// ---------------------------------------------------------------------------
const PAYMENT_FROM_DB: Record<string, PaymentStatus> = {
  unpaid: "unpaid", authorized: "unpaid", paid: "paid", refunded: "refunded", failed: "failed",
};
const PRODUCTION_FROM_QUEUE: Record<string, ProductionStatus> = {
  queued: "queued", mixing: "mixed", bottling: "bottled", done: "ready", on_hold: "queued",
};
const PRODUCTION_TO_QUEUE: Record<ProductionStatus, string | null> = {
  not_started: null, queued: "queued", oil_ready: "queued", mixed: "mixing",
  bottled: "bottling", ready: "done",
};
const SHIPPING_FROM_DB: Record<string, ShippingStatus> = {
  pending: "not_shipped", picked_up: "handed_over", in_transit: "in_transit",
  delivered: "delivered", returned: "returned", failed: "not_shipped",
};
const SHIPPING_TO_DB: Record<ShippingStatus, string> = {
  not_shipped: "pending", handed_over: "picked_up", in_transit: "in_transit",
  delivered: "delivered", returned: "returned",
};

const emptyAddress = (): StructuredAddress =>
  ({ emirate: "", area: "", street: "", building: "" });

function mapProduct(row: ProductRow): Product {
  const variants = row.product_variants ?? [];
  return {
    handle: row.handle,
    title: row.title_ar,
    // السعر المعروض = سعر المقاس المخزَّن (أرخص مقاس فعّال بسعر صالح). لا اشتقاق.
    priceFils: readyMadePriceFils(
      variants
        .filter((v) => v.is_active)
        .map((v) => v.price_fils)
        .filter((n): n is number => typeof n === "number" && n > 0)
        .sort((a, b) => a - b)[0] ?? null
    ),
    currency: row.currency,
    // الكمية المعروضة = مجموع مخزون المقاسات الفعّالة.
    quantity: variants.filter((v) => v.is_active).reduce((n, v) => n + v.stock_qty, 0),
    is_available: row.is_available,
    is_vip: row.is_vip,
    aliases: row.aliases ?? undefined,
    family: row.family ?? undefined,
    intensity: row.intensity ?? undefined,
  };
}

function mapOil(row: CatalogRow): CustomOil {
  return {
    code: row.code,
    brand: row.inspired_brand,
    name: row.perfume_name,
    kilo_price: toAed(row.kilo_price_fils),
  };
}

function mapOrder(row: OrderRow): Order {
  const lines: OrderLine[] = (row.order_items ?? []).map((item) => {
    const custom = item.custom_perfume_requests;
    return {
      id: item.id,
      kind: custom ? "custom" : "ready",
      title: item.title_snapshot,
      subtitle: custom
        ? `${custom.bottle_size}${custom.customer_notes ? ` · ${custom.customer_notes}` : ""}`
        : undefined,
      unitPriceFils: item.unit_price_fils,
      quantity: item.quantity,
      perfumeCode: custom?.perfume_catalog?.code ?? undefined,
      size: custom?.bottle_size ?? item.product_variants?.bottle_size ?? undefined,
    };
  });

  const queue = one(row.production_queue);
  const shipment = (row.shipments ?? [])[0] ?? null;
  const address = row.shipping_address ?? {};
  const customer = row.customers;

  return {
    orderNumber: row.order_number,
    createdAt: row.placed_at ?? row.created_at,
    customer: {
      name: customer?.full_name ?? "",
      phone: customer?.phone ?? "",
      address: {
        ...emptyAddress(),
        emirate: address.emirate ?? customer?.emirate ?? "",
        area: address.area ?? customer?.area ?? "",
        street: address.street ?? customer?.street ?? "",
        building: address.building ?? customer?.building ?? "",
        ...(address.flat ?? customer?.flat ? { flat: address.flat ?? customer?.flat ?? undefined } : {}),
      },
    },
    lines,
    subtotalFils: row.subtotal_fils,
    discountFils: row.discount_fils ?? 0,
    shippingFils: row.shipping_fils,
    totalFils: row.total_fils,
    currency: "AED",
    paymentStatus: PAYMENT_FROM_DB[row.payment_status] ?? "unpaid",
    productionStatus: queue ? PRODUCTION_FROM_QUEUE[queue.status] ?? "queued" : "not_started",
    shippingStatus: shipment ? SHIPPING_FROM_DB[shipment.status] ?? "not_shipped" : "not_shipped",
    trackingNumber: shipment?.tracking_number ?? null,
  };
}

/**
 * السطوح الإضافية التي لا يعرفها عقد الصفحات لكن المشروع يملكها في القاعدة.
 * موجودة كي يكون لكل جدول مسار قراءة واحد معروف، لا استعلام متناثر.
 */
export interface SupabaseDataSurface extends RazeenRepository {
  listProductVariants(handle?: string): Promise<ProductVariantRow[]>;
  listCustomPerfumeRequests(): Promise<CustomPerfumeRequestRow[]>;
  listCarts(): Promise<CartRow[]>;
  listCartItems(cartId: string): Promise<CartItemRow[]>;
  listShipments(): Promise<ShipmentRow[]>;
  listStagingOutbox(): Promise<StagingOutboxRow[]>;
}

export interface SupabaseRepositoryDeps {
  client: SupabaseClient;
  /**
   * مسار الطلب حين لا توجد جلسة. RLS يمنع anon من كل جداول الطلب، فالبديل
   * صريح ومحقون بدل شرط مخبّأ داخل كل دالة.
   */
  sessionScopedFallback: RazeenRepository;
}

export function createSupabaseRepository({ client, sessionScopedFallback }: SupabaseRepositoryDeps): SupabaseDataSurface {
  /** هل للمتصفّح جلسة؟ anon لا يرى أي جدول من جداول الطلب. */
  const hasSession = async (): Promise<boolean> => {
    const { data } = await client.auth.getSession();
    return Boolean(data.session);
  };

  const fetchOrders = async (): Promise<Order[]> => {
    const { data, error } = await client
      .from("orders").select(ORDER_SELECT).order("placed_at", { ascending: false });
    fail("orders", error);
    return ((data ?? []) as unknown as OrderRow[]).map(mapOrder);
  };

  const orderIdOf = async (orderNumber: string): Promise<string> => {
    const { data, error } = await client
      .from("orders").select("id").eq("order_number", orderNumber).maybeSingle();
    fail("orders lookup", error);
    if (!data) throw new Error(`لا يوجد طلب بالرقم ${orderNumber}`);
    return (data as { id: string }).id;
  };

  const readOrder = async (orderNumber: string): Promise<Order> => {
    const { data, error } = await client
      .from("orders").select(ORDER_SELECT).eq("order_number", orderNumber).maybeSingle();
    fail("order", error);
    if (!data) throw new Error(`لا يوجد طلب بالرقم ${orderNumber}`);
    return mapOrder(data as unknown as OrderRow);
  };

  return {
    // ---------------------------------------------------------------------
    // الرف العام — قراءة حيّة فعلاً عبر anon (سياسات *_read_all).
    // ---------------------------------------------------------------------
    async listProducts(): Promise<Product[]> {
      const { data, error } = await client
        .from("products")
        .select("handle, title_ar, title_en, family, intensity, base_price_fils, currency, is_available, is_vip, aliases, product_variants ( stock_qty, is_active, price_fils )")
        .order("handle");
      fail("products", error);
      return ((data ?? []) as unknown as ProductRow[]).map(mapProduct);
    },

    async getProduct(handle: string): Promise<Product | null> {
      const { data, error } = await client
        .from("products")
        .select("handle, title_ar, title_en, family, intensity, base_price_fils, currency, is_available, is_vip, aliases, product_variants ( stock_qty, is_active, price_fils )")
        .eq("handle", handle)
        .maybeSingle();
      fail("product", error);
      return data ? mapProduct(data as unknown as ProductRow) : null;
    },

    async listOils(): Promise<CustomOil[]> {
      const { data, error } = await client
        .from("perfume_catalog")
        .select("code, inspired_brand, perfume_name, kilo_price_fils")
        .eq("is_active", true)
        .order("code");
      fail("perfume_catalog", error);
      return ((data ?? []) as unknown as CatalogRow[]).map(mapOil);
    },

    async listProductVariants(handle?: string): Promise<ProductVariantRow[]> {
      let query = client
        .from("product_variants")
        .select("id, product_id, sku, bottle_size, price_fils, stock_qty, is_active")
        .order("sku");
      if (handle) query = query.like("sku", `${handle}-%`);
      const { data, error } = await query;
      fail("product_variants", error);
      return (data ?? []) as unknown as ProductVariantRow[];
    },

    // ---------------------------------------------------------------------
    // مسار الطلب — يحتاج جلسة. بلا جلسة: المخزن المحلي، صراحةً.
    // ---------------------------------------------------------------------
    async listOrders(): Promise<Order[]> {
      if (!(await hasSession())) return sessionScopedFallback.listOrders();
      return fetchOrders();
    },

    async getOrder(orderNumber: string): Promise<Order | null> {
      if (!(await hasSession())) return sessionScopedFallback.getOrder(orderNumber);
      const { data, error } = await client
        .from("orders").select(ORDER_SELECT).eq("order_number", orderNumber).maybeSingle();
      fail("order", error);
      return data ? mapOrder(data as unknown as OrderRow) : null;
    },

    async listProductionQueue(): Promise<Order[]> {
      if (!(await hasSession())) return sessionScopedFallback.listProductionQueue();
      // القاعدة نفسها لا تتغيّر مع تغيّر المخزن: المدفوع فقط.
      const orders = await fetchOrders();
      return orders.filter(isProductionEligible);
    },

    async createOrder(draft: OrderDraft): Promise<Order> {
      if (!(await hasSession())) return sessionScopedFallback.createOrder(draft);

      const { data: sessionData } = await client.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;

      // العميل: بحث بالهاتف ثم إنشاء عند الغياب.
      const existing = await client
        .from("customers").select("id").eq("phone", draft.customer.phone).maybeSingle();
      fail("customers lookup", existing.error);
      let customerId = (existing.data as { id: string } | null)?.id ?? null;
      if (!customerId) {
        const inserted = await client.from("customers").insert({
          user_id: userId,
          full_name: draft.customer.name,
          phone: draft.customer.phone,
          emirate: draft.customer.address.emirate,
          area: draft.customer.address.area,
          street: draft.customer.address.street,
          building: draft.customer.address.building,
          flat: draft.customer.address.flat ?? null,
        }).select("id").single();
        fail("customers insert", inserted.error);
        customerId = (inserted.data as { id: string }).id;
      }

      const orderNumber = `STG-${Date.now().toString().slice(-8)}`;
      const insertedOrder = await client.from("orders").insert({
        order_number: orderNumber,
        customer_id: customerId,
        // كل طلب يبدأ معلّقاً وغير مدفوع. الدفع وحده يرقّيه.
        status: "pending",
        payment_status: "unpaid",
        // تُحفظ كما عُرضت للعميل بالضبط — بلا إعادة حساب على الخادم.
        subtotal_fils: draft.subtotalFils,
        shipping_fils: draft.shippingFils,
        discount_fils: draft.discountFils,
        total_fils: draft.totalFils,
        currency: "AED",
        shipping_address: draft.customer.address,
      }).select("id").single();
      fail("orders insert", insertedOrder.error);
      const orderId = (insertedOrder.data as { id: string }).id;

      if (draft.lines.length > 0) {
        const items = await client.from("order_items").insert(
          draft.lines.map((line) => ({
            order_id: orderId,
            variant_id: null,
            custom_request_id: null,
            title_snapshot: line.title,
            quantity: line.quantity,
            unit_price_fils: line.unitPriceFils,
            line_total_fils: lineTotalFils(line),
          }))
        );
        fail("order_items insert", items.error);
      }

      return readOrder(orderNumber);
    },

    async setPaymentStatus(orderNumber: string, status: PaymentStatus): Promise<Order> {
      if (!(await hasSession())) return sessionScopedFallback.setPaymentStatus(orderNumber, status);
      const orderId = await orderIdOf(orderNumber);
      const updated = await client.from("orders")
        .update({ payment_status: status, status: status === "paid" ? "paid" : "pending" })
        .eq("id", orderId);
      fail("orders update", updated.error);
      if (status === "paid") {
        // الدفع الناجح وحده يفتح باب التصنيع — والقاعدة تفرضه بمشغّل أيضاً.
        const queued = await client.from("production_queue")
          .upsert({ order_id: orderId, status: "queued" }, { onConflict: "order_id" });
        fail("production_queue upsert", queued.error);
      }
      return readOrder(orderNumber);
    },

    async setProductionStatus(orderNumber: string, status: ProductionStatus): Promise<Order> {
      if (!(await hasSession())) return sessionScopedFallback.setProductionStatus(orderNumber, status);
      const orderId = await orderIdOf(orderNumber);
      const queueStatus = PRODUCTION_TO_QUEUE[status];
      if (queueStatus === null) {
        const removed = await client.from("production_queue").delete().eq("order_id", orderId);
        fail("production_queue delete", removed.error);
      } else {
        const upserted = await client.from("production_queue")
          .upsert({ order_id: orderId, status: queueStatus }, { onConflict: "order_id" });
        fail("production_queue upsert", upserted.error);
      }
      return readOrder(orderNumber);
    },

    async setShippingStatus(orderNumber: string, status: ShippingStatus, trackingNumber?: string): Promise<Order> {
      if (!(await hasSession())) return sessionScopedFallback.setShippingStatus(orderNumber, status, trackingNumber);
      const orderId = await orderIdOf(orderNumber);
      const existing = await client.from("shipments").select("id").eq("order_id", orderId).maybeSingle();
      fail("shipments lookup", existing.error);
      const patch = {
        order_id: orderId,
        status: SHIPPING_TO_DB[status],
        ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
        ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
      };
      const written = existing.data
        ? await client.from("shipments").update(patch).eq("id", (existing.data as { id: string }).id)
        : await client.from("shipments").insert(patch);
      fail("shipments write", written.error);
      return readOrder(orderNumber);
    },

    // ---------------------------------------------------------------------
    // سطوح قراءة إضافية (تحتاج جلسة كذلك؛ anon يراها فارغة بحكم RLS).
    // ---------------------------------------------------------------------
    async listCustomPerfumeRequests(): Promise<CustomPerfumeRequestRow[]> {
      const { data, error } = await client
        .from("custom_perfume_requests")
        .select("id, customer_id, catalog_id, free_text_request, bottle_size, quantity, quoted_price_fils, status, customer_notes, created_at")
        .order("created_at", { ascending: false });
      fail("custom_perfume_requests", error);
      return (data ?? []) as unknown as CustomPerfumeRequestRow[];
    },

    async listCarts(): Promise<CartRow[]> {
      const { data, error } = await client
        .from("carts").select("id, customer_id, session_token, status, created_at")
        .order("created_at", { ascending: false });
      fail("carts", error);
      return (data ?? []) as unknown as CartRow[];
    },

    async listCartItems(cartId: string): Promise<CartItemRow[]> {
      const { data, error } = await client
        .from("cart_items").select("id, cart_id, variant_id, custom_request_id, quantity, unit_price_fils")
        .eq("cart_id", cartId);
      fail("cart_items", error);
      return (data ?? []) as unknown as CartItemRow[];
    },

    async listShipments(): Promise<ShipmentRow[]> {
      const { data, error } = await client
        .from("shipments").select("id, order_id, carrier, tracking_number, status, shipped_at, delivered_at");
      fail("shipments", error);
      return (data ?? []) as unknown as ShipmentRow[];
    },

    async listStagingOutbox(): Promise<StagingOutboxRow[]> {
      const { data, error } = await client
        .from("staging_outbox")
        .select("id, channel, recipient, subject, body, related_entity, related_entity_id, would_have_sent_at")
        .order("would_have_sent_at", { ascending: false });
      fail("staging_outbox", error);
      return (data ?? []) as unknown as StagingOutboxRow[];
    },
  };
}
