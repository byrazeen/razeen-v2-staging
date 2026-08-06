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
 * ولذلك صار مسار الطلب كله خلف **جلسة مجهولة دائمة** (`@/lib/anonSession`):
 * سلة، وبنود سلة، وطلبات، وبنود طلب، وطلبات عطر مخصص، ودفعة وهمية — كلها في
 * القاعدة تحت `auth.uid()`. لا شيء منها في `localStorage`، ولا سطر في هذا
 * الملف يقرأ منه أو يكتب فيه.
 *
 * و`sessionScopedFallback` بقي لحالة واحدة معلنة: تعذّر الجلسة أصلاً (تخزين
 * محجوب، أو تسجيل الدخول المجهول غير مفعّل في المشروع). حينها تبقى الشاشات
 * تعمل على المخزن المحلي بدل أن تنهار — ولا تدّعي أنها القاعدة.
 *
 * والعميل هنا `PostgrestClient` وحده لا مظلّة `supabase-js`: التطبيق لا
 * يستعمل غير `.from()` و`.rpc()`، فراجع `@/lib/supabaseClient`.
 *
 * Reads use the publishable key plus the anonymous session's access token, so
 * RLS sees a real `auth.uid()`. The order lifecycle lives in the database; the
 * injected local repository is a declared last resort, never the source.
 */
import type {
  PaymentStatus, ProductionStatus, ShippingStatus, StructuredAddress,
} from "@/config/customOrderContract";
import type { CustomOil, Product } from "@/data/mock";
import type {
  Order, OrderLine, PlaceOrderItem, PlaceOrderRequest, RazeenRepository,
} from "@/data/repositoryContract";
import { isProductionEligible } from "@/data/repositoryContract";
import { ensureAnonSession } from "@/lib/anonSession";
import { readyMadePriceFils } from "@/lib/pricing";
import type { RazeenPostgrestClient } from "@/lib/supabaseClient";

const FILS_PER_AED = 100;
/** الفلس هو وحدة الحساب في التطبيق كما في القاعدة — لا تحويل ولا تقريب للمال. */
const toAed = (fils: number): number => Math.round(fils / FILS_PER_AED);

/** خطأ PostgREST يُرفع كاستثناء واحد معروف الشكل. */
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
export interface AuditLogRow {
  id: string; actor_id: string | null; actor_role: string | null; action: string;
  entity: string; entity_id: string | null; created_at: string;
}
export interface StagingOutboxRow {
  id: string; channel: string; recipient: string; subject: string | null; body: string;
  related_entity: string | null; related_entity_id: string | null; would_have_sent_at: string;
}


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
  listAuditLogs(): Promise<AuditLogRow[]>;
}

// ---------------------------------------------------------------------------
// ترجمة الحالات بين القاعدة والعقد.
//
// العقد يحمل ثلاثة محاور مستقلة (دفع · تصنيع · شحن) لأن التدقيق وجد طلباً
// واحداً بخمس مفردات متناقضة. والقاعدة تحمل المحاور نفسها موزّعة على ثلاثة
// جداول: `orders.status` و`production_queue.status` و`shipments.status`.
// الترجمة مكتوبة هنا مرة واحدة وصراحةً، لا مستنتَجة في كل استعلام.
//
// وفيها فقدٌ معلوم ومقصود التصريح به: 0006 يسحب الكتابة على
// `production_queue` و`shipments` عن كل دور عميل، ولا دالة إدارية لهما.
// فالمدير من المتصفّح يكتب `orders.status` وحدها عبر `admin_set_order_status`،
// ولذلك «الزيت جاهز» و«مُركَّب» و«مُعبَّأ» تُكتب كلها `in_production` وتُقرأ
// من طابور الإنتاج إن وُجد صفّه. هذا نقص في سطح الكتابة لا في الترجمة، ولا
// يُداوى إلا بهجرة جديدة — والهجرات هنا مطبَّقة ومدموجة ولا تُمَسّ.
// ---------------------------------------------------------------------------
const QUEUE_TO_PRODUCTION: Record<string, ProductionStatus> = {
  queued: "queued", mixing: "mixed", bottling: "bottled", done: "ready", on_hold: "queued",
};
const SHIPMENT_TO_SHIPPING: Record<string, ShippingStatus> = {
  pending: "not_shipped", picked_up: "handed_over", in_transit: "in_transit",
  delivered: "delivered", returned: "returned", failed: "not_shipped",
};
/** حالة الطلب التي تعبّر عن كل حالة تصنيع — أدقّ ما يسمح به سطح الكتابة. */
const PRODUCTION_TO_ORDER: Record<ProductionStatus, string> = {
  not_started: "pending", queued: "paid", oil_ready: "in_production",
  mixed: "in_production", bottled: "in_production", ready: "ready",
};
const SHIPPING_TO_ORDER: Record<ShippingStatus, string | null> = {
  not_shipped: null, handed_over: "shipped", in_transit: "shipped",
  delivered: "delivered", returned: "cancelled",
};
const PAYMENT_TO_ORDER: Record<PaymentStatus, string | null> = {
  unpaid: "pending", paid: "paid", failed: "failed", refunded: null,
};

function productionOf(orderStatus: string, queueStatus?: string): ProductionStatus {
  if (orderStatus === "ready" || orderStatus === "shipped" || orderStatus === "delivered") return "ready";
  if (queueStatus) return QUEUE_TO_PRODUCTION[queueStatus] ?? "queued";
  if (orderStatus === "in_production") return "mixed";
  if (orderStatus === "paid") return "queued";
  return "not_started";
}

function shippingOf(orderStatus: string, shipmentStatus?: string): ShippingStatus {
  if (shipmentStatus) return SHIPMENT_TO_SHIPPING[shipmentStatus] ?? "not_shipped";
  if (orderStatus === "delivered") return "delivered";
  if (orderStatus === "shipped") return "handed_over";
  return "not_shipped";
}

/** الحقل الوحيد المطلوب من العقد. القاعدة تحفظ العنوان jsonb. */
function addressOf(raw: unknown): StructuredAddress {
  const a = (raw ?? {}) as Record<string, string | undefined>;
  return {
    emirate: a.emirate ?? "", area: a.area ?? "", street: a.street ?? "",
    building: a.building ?? "", flat: a.flat,
  };
}

/** صفّ طلب كما يعود من الاستعلام الواحد أدناه. */
interface OrderRow {
  id: string; order_number: string; status: string; payment_status: string;
  subtotal_fils: number; discount_fils: number; shipping_fils: number; total_fils: number;
  currency: string; placed_at: string; shipping_address: unknown;
  customers?: { full_name: string; phone: string } | null;
  order_items?: Array<{
    id: string; title_snapshot: string; quantity: number; unit_price_fils: number;
    variant_id: string | null; custom_request_id: string | null;
    custom_perfume_requests?: { bottle_size: string | null } | null;
  }>;
  production_queue?: Array<{ status: string }> | { status: string } | null;
  shipments?: Array<{ status: string; tracking_number: string | null }> | null;
}

const first = <T,>(value: T[] | T | null | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : (value ?? undefined);

function mapOrder(row: OrderRow): Order {
  const queue = first(row.production_queue);
  const shipment = first(row.shipments);
  const lines: OrderLine[] = (row.order_items ?? []).map((item) => ({
    id: item.id,
    kind: item.custom_request_id ? "custom" : "ready",
    title: item.title_snapshot,
    subtitle: item.custom_perfume_requests?.bottle_size ?? undefined,
    unitPriceFils: item.unit_price_fils,
    quantity: item.quantity,
    size: item.custom_perfume_requests?.bottle_size ?? undefined,
  }));
  return {
    orderNumber: row.order_number,
    createdAt: row.placed_at,
    customer: {
      name: row.customers?.full_name ?? "",
      phone: row.customers?.phone ?? "",
      address: addressOf(row.shipping_address),
    },
    lines,
    subtotalFils: row.subtotal_fils,
    discountFils: row.discount_fils,
    shippingFils: row.shipping_fils,
    totalFils: row.total_fils,
    currency: "AED",
    paymentStatus: (row.payment_status === "authorized" ? "unpaid" : row.payment_status) as PaymentStatus,
    productionStatus: productionOf(row.status, queue?.status),
    shippingStatus: shippingOf(row.status, shipment?.status),
    trackingNumber: shipment?.tracking_number ?? null,
  };
}

const ORDER_SELECT =
  "id, order_number, status, payment_status, subtotal_fils, discount_fils, shipping_fils, " +
  "total_fils, currency, placed_at, shipping_address, " +
  "customers ( full_name, phone ), " +
  "order_items ( id, title_snapshot, quantity, unit_price_fils, variant_id, custom_request_id, " +
  "custom_perfume_requests ( bottle_size ) ), " +
  "production_queue ( status ), shipments ( status, tracking_number )";

export interface SupabaseRepositoryDeps {
  client: RazeenPostgrestClient;
  /**
   * مسار القراءة العامة حين تتعذّر الجلسة تماماً (متصفّح بلا تخزين، أو
   * `signInAnonymously` معطّل في المشروع). الطلب حينها لا يُنشأ أصلاً —
   * `place_order` مُصرَّح بها لـ`authenticated` وحدها — فالبديل يُبقي الشاشات
   * تعمل بدل أن تنهار، ولا يدّعي أنه القاعدة.
   */
  sessionScopedFallback: RazeenRepository;
}

export function createSupabaseRepository({ client, sessionScopedFallback }: SupabaseRepositoryDeps): SupabaseDataSurface {
  /** جلسة أو لا شيء. مسار الطلب كله يمرّ من هنا أولاً. */
  async function requireSession(): Promise<boolean> {
    try {
      return (await ensureAnonSession()) !== null;
    } catch (error) {
      console.error("anonymous session unavailable", error);
      return false;
    }
  }

  /** معرّف الطلب من رقمه — الدوال الإدارية تعمل بالمعرّف لا بالرقم. */
  async function orderIdOf(orderNumber: string): Promise<string> {
    const { data, error } = await client
      .from("orders").select("id").eq("order_number", orderNumber).maybeSingle();
    fail("order id", error);
    const id = (data as { id?: string } | null)?.id;
    if (!id) throw new Error(`لا يوجد طلب بالرقم ${orderNumber}`);
    return id;
  }

  /**
   * الباب الإداري الوحيد. الكتابة المباشرة على `orders.status` /
   * `payment_status` مسحوبة عن كل دور عميل في 0006، فهذه ليست تفضيلاً أسلوبياً:
   * لا مسار آخر موجود. وغير المدير يُرفض داخل الدالة برسالة مفهومة.
   */
  async function adminSetOrderStatus(
    orderNumber: string, status: string | null, paymentStatus: string | null
  ): Promise<Order> {
    const id = await orderIdOf(orderNumber);
    const { error } = await client.rpc("admin_set_order_status", {
      p_order_id: id, p_status: status, p_payment_status: paymentStatus,
    });
    if (error) {
      throw new Error(
        "تعذّر تحديث حالة الطلب — هذا الحساب ليس مديراً في قاعدة staging. " +
        "بوابة الإدارة هنا وهمية، والصلاحية الحقيقية في جدول admin_users."
      );
    }
    const updated = await readOrder(orderNumber);
    if (!updated) throw new Error(`لا يوجد طلب بالرقم ${orderNumber}`);
    return updated;
  }

  async function readOrder(orderNumber: string): Promise<Order | null> {
    const { data, error } = await client
      .from("orders").select(ORDER_SELECT).eq("order_number", orderNumber).maybeSingle();
    fail("order", error);
    return data ? mapOrder(data as unknown as OrderRow) : null;
  }

  // -------------------------------------------------------------------------
  // السلة الخادمية
  // -------------------------------------------------------------------------
  /** سلة المستخدم المفتوحة — تُقرأ أولاً وتُنشأ فقط إن لم توجد. */
  async function openCartId(create: boolean): Promise<string | null> {
    const session = await ensureAnonSession();
    const uid = session?.user?.id;
    if (!uid) return null;

    const { data, error } = await client
      .from("carts").select("id").eq("status", "open").limit(1).maybeSingle();
    fail("carts", error);
    const existing = (data as { id?: string } | null)?.id;
    if (existing) return existing;
    if (!create) return null;

    const inserted = await client
      .from("carts")
      // `session_token` يحمل معرّف المستخدم كي يُستوفى قيد `cart_has_owner`
      // قبل أن يوجد صف عميل — وصف العميل لا يوجد قبل أن يُكتب هاتف حقيقي.
      .insert({ user_id: uid, session_token: uid, status: "open" })
      .select("id").maybeSingle();
    fail("cart insert", inserted.error);
    return (inserted.data as { id?: string } | null)?.id ?? null;
  }

  /** مقبض المنتج ⇒ المقاس المخزَّن الذي يُعرض سعره. نفس قاعدة العرض حرفياً. */
  async function variantIdForHandle(handle: string): Promise<string | null> {
    const { data, error } = await client
      .from("product_variants")
      .select("id, price_fils, is_active, products!inner ( handle )")
      .eq("products.handle", handle)
      .eq("is_active", true)
      .order("price_fils", { ascending: true });
    fail("variant lookup", error);
    const rows = (data ?? []) as unknown as Array<{ id: string; price_fils: number | null }>;
    const usable = rows.find((r) => readyMadePriceFils(r.price_fils) !== null);
    return usable?.id ?? null;
  }

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
    // مسار الطلب — القاعدة هي المصدر، والجلسة المجهولة هي الهوية.
    //
    // لا سطر هنا يقرأ أو يكتب `localStorage`: ما يُعرض هو ما ردّته القاعدة
    // تحت RLS. وما لا يملكه هذا المستخدم لا يصل إليه أصلاً — لا لأننا نُصفّيه
    // بعد وصوله، بل لأن `orders_select_own` لا تُرجعه.
    // ---------------------------------------------------------------------
    async listOrders(): Promise<Order[]> {
      if (!(await requireSession())) return sessionScopedFallback.listOrders();
      const { data, error } = await client
        .from("orders").select(ORDER_SELECT).order("placed_at", { ascending: false });
      fail("orders", error);
      return ((data ?? []) as unknown as OrderRow[]).map(mapOrder);
    },

    async getOrder(orderNumber: string): Promise<Order | null> {
      if (!(await requireSession())) return sessionScopedFallback.getOrder(orderNumber);
      return readOrder(orderNumber);
    },

    /**
     * قائمة التصنيع = المدفوع فقط، والقاعدة تقولها مرتين: `payment_status`
     * في الاستعلام، و`isProductionEligible` على الناتج. التكرار مقصود.
     */
    async listProductionQueue(): Promise<Order[]> {
      if (!(await requireSession())) return sessionScopedFallback.listProductionQueue();
      const { data, error } = await client
        .from("orders").select(ORDER_SELECT)
        .eq("payment_status", "paid")
        .order("placed_at", { ascending: false });
      fail("production queue", error);
      return ((data ?? []) as unknown as OrderRow[]).map(mapOrder).filter(isProductionEligible);
    },

    /**
     * إنشاء الطلب — استدعاء واحد لـ`place_order`، ولا شيء غيره.
     *
     * ما يُرسَل: النوع، ومعرّف المقاس أو رمز الكتالوج، والمقاس، والكمية،
     * وبيانات العميل، والمفتاح، والنتيجة المحاكاة. **ولا مبلغ واحد.** الدالة
     * تُسعّر من القاعدة وتطبّق قاعدة الثلاثة وتكتب الطلب وبنوده ودفعته ذرّياً،
     * وتُدخل المدفوع وحده في طابور الإنتاج.
     */
    async placeOrder(request: PlaceOrderRequest): Promise<Order> {
      if (!(await requireSession())) return sessionScopedFallback.placeOrder(request);

      const items: Array<Record<string, unknown>> = [];
      for (const item of request.items as PlaceOrderItem[]) {
        if (item.kind === "ready") {
          const variantId = item.handle ? await variantIdForHandle(item.handle) : null;
          if (!variantId) throw new Error(`لا يوجد مقاس متاح للشراء من ${item.handle ?? ""}`);
          items.push({ kind: "ready", variant_id: variantId, quantity: item.quantity });
        } else {
          items.push({
            kind: "custom",
            catalog_code: item.catalogCode ?? undefined,
            free_text: item.catalogCode ? undefined : item.freeText,
            size: item.size,
            quantity: item.quantity,
            notes: item.notes,
          });
        }
      }

      const { data, error } = await client.rpc("place_order", {
        p_items: items,
        p_customer: {
          full_name: request.customer.name,
          phone: request.customer.phone,
          emirate: request.customer.address.emirate,
          area: request.customer.address.area,
          street: request.customer.address.street,
          building: request.customer.address.building,
          flat: request.customer.address.flat ?? null,
        },
        p_idempotency_key: request.idempotencyKey,
        p_outcome: request.outcome,
      });
      fail("place_order", error);

      const placed = data as { order_number?: string } | null;
      if (!placed?.order_number) throw new Error("place_order لم يُعد رقم طلب");
      const order = await readOrder(placed.order_number);
      if (!order) throw new Error(`تعذّر قراءة الطلب ${placed.order_number} بعد إنشائه`);
      return order;
    },

    // -----------------------------------------------------------------------
    // السلة — الخادم هو المصدر. `loadCart` لا تدمج ولا تُصالح: ما في القاعدة
    // هو السلة، وما في التخزين المحلي نسخةٌ للرسم الأول تُستبدل بما يعود.
    //
    // حدٌّ معلن: البند المخصص يحتاج صف `custom_perfume_requests`، وهو
    // `customer_id not null`، وصف العميل يحتاج هاتفاً حقيقياً لا يُعرف قبل
    // إتمام الطلب. فالبنود المخصصة تُنشأ خادمياً داخل `place_order` عند الدفع،
    // وقبله لا تُكتب في `cart_items`. اختراع هاتفٍ ليُستوفى القيد كان سيلصق
    // رقماً كاذباً بالعميل إلى الأبد — والهجرات مدموجة ولا تُمَسّ.
    // -----------------------------------------------------------------------
    async loadCart(): Promise<OrderLine[]> {
      if (!(await requireSession())) return sessionScopedFallback.loadCart();
      const cartId = await openCartId(false);
      if (!cartId) return [];
      const { data, error } = await client
        .from("cart_items")
        .select("id, quantity, unit_price_fils, variant_id, product_variants ( bottle_size, products ( handle, title_ar ) )")
        .eq("cart_id", cartId);
      fail("cart_items", error);
      const rows = (data ?? []) as unknown as Array<{
        id: string; quantity: number; unit_price_fils: number; variant_id: string | null;
        product_variants?: { bottle_size: string | null; products?: { handle: string; title_ar: string } | null } | null;
      }>;
      return rows
        .filter((r) => r.variant_id && r.product_variants?.products)
        .map((r) => ({
          id: `ready:${r.product_variants!.products!.handle}`,
          kind: "ready" as const,
          title: r.product_variants!.products!.title_ar,
          unitPriceFils: r.unit_price_fils,
          quantity: r.quantity,
        }));
    },

    async saveCart(lines: OrderLine[]): Promise<void> {
      if (!(await requireSession())) return sessionScopedFallback.saveCart(lines);
      const cartId = await openCartId(true);
      if (!cartId) return;

      const ready = lines.filter((l) => l.kind === "ready" && l.id.startsWith("ready:"));
      const rows: Array<Record<string, unknown>> = [];
      for (const line of ready) {
        const variantId = await variantIdForHandle(line.id.slice("ready:".length));
        if (!variantId) continue;
        rows.push({
          cart_id: cartId, variant_id: variantId,
          quantity: line.quantity, unit_price_fils: line.unitPriceFils,
        });
      }

      // استبدال كامل لا مزامنة تفاضلية: السلة صغيرة، والاستبدال لا يمكن أن
      // يترك بنداً يتيماً من حالة سابقة.
      const removed = await client.from("cart_items").delete().eq("cart_id", cartId);
      fail("cart clear", removed.error);
      if (rows.length > 0) {
        const inserted = await client.from("cart_items").insert(rows);
        fail("cart save", inserted.error);
      }
    },

    // حالات الطلب: البابان المُعلنان في 0006، لا UPDATE مباشرة (وهي ممنوعة).
    setPaymentStatus: async (orderNumber, status) =>
      adminSetOrderStatus(orderNumber, PAYMENT_TO_ORDER[status] ?? null, status),

    setProductionStatus: async (orderNumber, status) =>
      adminSetOrderStatus(orderNumber, PRODUCTION_TO_ORDER[status], null),

    setShippingStatus: async (orderNumber, status) =>
      adminSetOrderStatus(orderNumber, SHIPPING_TO_ORDER[status], null),

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

    /**
     * سجلّ التدقيق — قراءته للمدير وحده (`audit_logs_admin_read`)، وكتابته
     * ممنوعة على كل دور عميل. يُقرأ من القاعدة لا من أي مخزن محلي.
     */
    async listAuditLogs(): Promise<AuditLogRow[]> {
      if (!(await requireSession())) return [];
      const { data, error } = await client
        .from("audit_logs")
        .select("id, actor_id, actor_role, action, entity, entity_id, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      fail("audit_logs", error);
      return (data ?? []) as unknown as AuditLogRow[];
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