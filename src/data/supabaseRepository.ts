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
 * ولذلك صار مسار المتسوّق كله خلف **جلسة ضيف** (`@/lib/guestSession`): سلة،
 * وبنود سلة، وطلبات، وبنود طلب، وطلبات عطر مخصّص، ودفعة وهمية — كلها في
 * القاعدة تحت `guest_session_id`، ولا يصلها المتصفّح إلا عبر دوال 0010
 * المُصرَّح بها لـ`anon`، وكلٌّ منها تتحقّق من الرمز بنفسها أولاً.
 *
 * ثلاثة أشياء يجب أن تُقرأ معاً هنا:
 *
 *   ١) **لا سعر يُرسَل، في أي استدعاء.** المتصفّح يرسل معرّفات وكميات ورمزاً.
 *      `guest_set_cart_item` تقرأ السعر من الرفّ، و`guest_place_order` تُسعّر
 *      الطلب كله من القاعدة. لا حقل سعر في أي جسم طلب يخرج من هذا الملف.
 *   ٢) **لا `localStorage` في هذا الملف إطلاقاً.** ما يُعرض هو ما ردّته
 *      القاعدة في هذا التحميل بالذات. الرمز وحده مخزَّن، وهو في `guestSession`.
 *   ٣) **مسار الإدارة لا يحمل رمز ضيف.** قراءات الإدارة وكتاباتها تبقى على
 *      الجداول و`admin_set_order_status` كما كانت — والفرع مكتوب صراحةً
 *      باسم `isAdminSignedIn()` كي لا يُخلط المساران بالصدفة.
 *
 * و`sessionScopedFallback` بقي لحالة واحدة معلنة: تعذّر الرمز أصلاً (تخزين
 * محجوب، أو سقف الإصدار العالمي). حينها تبقى الشاشات تعمل على المخزن المحلي
 * بدل أن تنهار — ولا تدّعي أنها القاعدة.
 *
 * والعميل هنا `PostgrestClient` وحده لا مظلّة `supabase-js`: التطبيق لا
 * يستعمل غير `.from()` و`.rpc()`، فراجع `@/lib/supabaseClient`.
 *
 * Reads use the publishable key alone — the role is always `anon`. Guest
 * identity travels as a token argument to the SECURITY DEFINER functions from
 * migration 0010, never as a bearer credential and never through GoTrue. The
 * order lifecycle lives in the database; the injected local repository is a
 * declared last resort, never the source.
 */
import type {
  PaymentStatus, ProductionStatus, ShippingStatus, StructuredAddress,
} from "@/config/customOrderContract";
import type { CustomOil, Product } from "@/data/mock";
import type {
  Order, OrderLine, PlaceOrderItem, PlaceOrderRequest, RazeenRepository,
} from "@/data/repositoryContract";
import { isProductionEligible } from "@/data/repositoryContract";
import { isAdminSignedIn } from "@/lib/adminMode";
import { ensureGuestToken, withGuestToken } from "@/lib/guestSession";
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

/** ردّ `guest_create_custom_request` / عنصر `guest_list_custom_requests`. */
export interface GuestCustomRequest {
  request_id: string; catalog_code?: string | null; free_text_request?: string | null;
  bottle_size: string; quantity: number; quoted_price_fils: number;
  status: string; created_at?: string; cart_id?: string | null;
}

/**
 * السطوح الإضافية التي لا يعرفها عقد الصفحات لكن المشروع يملكها في القاعدة.
 * موجودة كي يكون لكل جدول مسار قراءة واحد معروف، لا استعلام متناثر.
 */
export interface SupabaseDataSurface extends RazeenRepository {
  listProductVariants(handle?: string): Promise<ProductVariantRow[]>;
  listCustomPerfumeRequests(): Promise<CustomPerfumeRequestRow[]>;
  createCustomRequest(input: {
    bottleSize: string; catalogCode?: string; freeText?: string;
    quantity?: number; notes?: string; addToCart?: boolean;
  }): Promise<GuestCustomRequest>;
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

/**
 * صفّ طلب كما تعيده `guest_order_status` — شكل آخر لأنه ردّ دالة لا صفّ جدول.
 *
 * وما ينقص فيه يُقال بصراحة: الدالة لا تُعيد اسم العميل ولا هاتفه (لا حاجة
 * إليهما في «طلباتي»، وإعادتهما توسيع لسطح البيانات بلا سبب)، ولا صفّ طابور
 * الإنتاج ولا الشحنة. فالمحوران الآخران يُشتقّان من `status` بالترجمة نفسها
 * المستعملة للمسار الجدولي — لا جدول ترجمة ثانٍ.
 */
interface GuestOrderRow {
  order_id: string; order_number: string; status: string; payment_status: string;
  subtotal_fils: number; discount_fils: number; shipping_fils: number; total_fils: number;
  currency: string; placed_at: string;
  items?: Array<{ title: string; quantity: number; unit_price_fils: number; line_total_fils: number }>;
}

function mapGuestOrder(row: GuestOrderRow): Order {
  return {
    orderNumber: row.order_number,
    createdAt: row.placed_at,
    customer: { name: "", phone: "", address: addressOf(null) },
    lines: (row.items ?? []).map((item, i) => ({
      id: `${row.order_number}:${i}`,
      kind: "ready" as const,
      title: item.title,
      unitPriceFils: item.unit_price_fils,
      quantity: item.quantity,
    })),
    subtotalFils: row.subtotal_fils,
    discountFils: row.discount_fils,
    shippingFils: row.shipping_fils,
    totalFils: row.total_fils,
    currency: "AED",
    paymentStatus: (row.payment_status === "authorized" ? "unpaid" : row.payment_status) as PaymentStatus,
    productionStatus: productionOf(row.status),
    shippingStatus: shippingOf(row.status),
    trackingNumber: null,
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
   * مسار القراءة العامة حين يتعذّر رمز الضيف تماماً (متصفّح بلا تخزين، أو
   * سقف الإصدار العالمي مستهلك). الطلب حينها لا يُنشأ أصلاً — كل دالة ضيف
   * ترفض بلا رمز صالح — فالبديل يُبقي الشاشات تعمل بدل أن تنهار، ولا يدّعي
   * أنه القاعدة.
   */
  sessionScopedFallback: RazeenRepository;
}

export function createSupabaseRepository({ client, sessionScopedFallback }: SupabaseRepositoryDeps): SupabaseDataSurface {
  /**
   * رمز ضيف أو لا شيء. مسار المتسوّق كله يمرّ من هنا أولاً، والفشل يعني
   * الرجوع إلى المخزن المحلي المعلن لا الانهيار.
   */
  async function hasGuestSession(): Promise<boolean> {
    try {
      await ensureGuestToken();
      return true;
    } catch (error) {
      console.error("guest session unavailable", error);
      return false;
    }
  }

  /**
   * استدعاء دالة ضيف. خطأ PostgREST يُرفع استثناءً — وهذا شرط لا تجميل:
   * `withGuestToken` لا تستطيع أن تنتعش من رمز ميّت إن ابتُلع الخطأ هنا.
   */
  async function guestRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      const detail = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
      throw new Error(`Supabase ${fn}: ${detail}`);
    }
    return data as T;
  }

  // -------------------------------------------------------------------------
  // فهرس المقاسات: `variant_id` ⇄ مقبض المنتج.
  //
  // دوال الضيف تتكلّم بمعرّفات المقاسات، وعقد الصفحات يتكلّم بمقابض
  // (`ready:<handle>`). الترجمة تحتاج قراءة واحدة من الرفّ العام — وهو مقروء
  // لـ`anon` بحكم `*_read_all` — وتُحفظ لبقية عمر الصفحة لا لأكثر.
  // -------------------------------------------------------------------------
  let variantIndex: Promise<Map<string, { handle: string; title: string }>> | null = null;

  function variantsByHandle(): Promise<Map<string, { handle: string; title: string }>> {
    if (!variantIndex) {
      variantIndex = (async () => {
        const { data, error } = await client
          .from("product_variants")
          .select("id, price_fils, is_active, products ( handle, title_ar )")
          .eq("is_active", true)
          .order("price_fils", { ascending: true });
        fail("variant index", error);
        const rows = (data ?? []) as unknown as Array<{
          id: string; products?: { handle: string; title_ar: string } | null;
        }>;
        const map = new Map<string, { handle: string; title: string }>();
        for (const r of rows) {
          if (r.products?.handle) map.set(r.id, { handle: r.products.handle, title: r.products.title_ar });
        }
        return map;
      })().catch((error) => { variantIndex = null; throw error; });
    }
    return variantIndex;
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

  /** طلبات الجلسة كما تعيدها `guest_order_status`، بترجمة واحدة. */
  async function guestOrders(orderNumber?: string): Promise<Order[]> {
    const rows = await withGuestToken((p_token) =>
      guestRpc<GuestOrderRow[]>("guest_order_status",
        orderNumber ? { p_token, p_order_number: orderNumber } : { p_token }));
    return (rows ?? []).map(mapGuestOrder);
  }

  async function readOrder(orderNumber: string): Promise<Order | null> {
    const { data, error } = await client
      .from("orders").select(ORDER_SELECT).eq("order_number", orderNumber).maybeSingle();
    fail("order", error);
    return data ? mapOrder(data as unknown as OrderRow) : null;
  }

  // -------------------------------------------------------------------------
  // السلة الخادمية — عبر `guest_get_cart` / `guest_set_cart_item` /
  // `guest_clear_cart` وحدها. لا `from("carts")` ولا `from("cart_items")` في
  // مسار المتسوّق: الجداول محجوبة عنه بسياسة مقيِّدة في 0009، والباب الوحيد
  // هو الدالة التي تتحقّق من الرمز.
  // -------------------------------------------------------------------------
  interface GuestCartItem {
    item_id: string; kind: "ready" | "custom"; variant_id: string | null;
    custom_request_id: string | null; title: string; quantity: number;
    unit_price_fils: number; created_at: string;
  }
  interface GuestCart { cart_id: string; items: GuestCartItem[] }

  /** سطور السلة كما تعيدها القاعدة ⇒ شكل العقد الذي تعرفه الصفحات. */
  async function linesFromGuestCart(cart: GuestCart): Promise<OrderLine[]> {
    const index = await variantsByHandle();
    return (cart.items ?? [])
      .filter((i) => i.kind === "ready" && i.variant_id && index.has(i.variant_id))
      .map((i) => ({
        id: `ready:${index.get(i.variant_id!)!.handle}`,
        kind: "ready" as const,
        title: i.title,
        // السعر من ردّ القاعدة، لا من حساب هنا ولا من نسخة محلية.
        unitPriceFils: i.unit_price_fils,
        quantity: i.quantity,
      }));
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
      // مسار الإدارة كما كان: قراءة جدولية تحت RLS، بلا رمز ضيف.
      if (isAdminSignedIn()) {
        const { data, error } = await client
          .from("orders").select(ORDER_SELECT).order("placed_at", { ascending: false });
        fail("orders", error);
        return ((data ?? []) as unknown as OrderRow[]).map(mapOrder);
      }
      if (!(await hasGuestSession())) return sessionScopedFallback.listOrders();
      return guestOrders();
    },

    async getOrder(orderNumber: string): Promise<Order | null> {
      if (isAdminSignedIn()) return readOrder(orderNumber);
      if (!(await hasGuestSession())) return sessionScopedFallback.getOrder(orderNumber);
      return (await guestOrders(orderNumber))[0] ?? null;
    },

    /**
     * قائمة التصنيع = المدفوع فقط، والقاعدة تقولها مرتين: `payment_status`
     * في الاستعلام، و`isProductionEligible` على الناتج. التكرار مقصود.
     */
    async listProductionQueue(): Promise<Order[]> {
      // شاشة إدارية خلف البوّابة — قراءة جدولية، بلا رمز ضيف.
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
      if (!(await hasGuestSession())) return sessionScopedFallback.placeOrder(request);

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

      // الاستدعاء الوحيد. لاحظ ما ليس هنا: لا `subtotal` ولا `total` ولا
      // `unit_price` ولا `discount`. المفتاح هو نفسه عند إعادة الإرسال،
      // فالنقرة الثانية تُعيد الطلب الأول ولا تُنشئ ثانياً.
      const placed = await withGuestToken((p_token) =>
        guestRpc<{ order_number?: string } | null>("guest_place_order", {
          p_token,
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
        }));

      if (!placed?.order_number) throw new Error("guest_place_order لم يُعد رقم طلب");
      const order = (await guestOrders(placed.order_number))[0] ?? null;
      if (!order) throw new Error(`تعذّر قراءة الطلب ${placed.order_number} بعد إنشائه`);
      return order;
    },

    // -----------------------------------------------------------------------
    // السلة — الخادم هو المصدر. `loadCart` لا تدمج ولا تُصالح: ما ترجعه
    // `guest_get_cart` **هو** السلة، وما في التخزين المحلي نسخةٌ للرسم الأول
    // تُستبدل بما يعود. الترتيب مفروض في `@/lib/cart` صراحةً.
    //
    // وحدٌّ معلن بقي كما كان: البند المخصّص يُنشأ خادمياً عند الدفع داخل
    // `guest_place_order` (أو عبر `createCustomRequest` حين تُطلب صراحةً)،
    // وقبله يعيش في النسخة العابرة وحدها.
    // -----------------------------------------------------------------------
    async loadCart(): Promise<OrderLine[]> {
      if (!(await hasGuestSession())) return sessionScopedFallback.loadCart();
      const cart = await withGuestToken((p_token) =>
        guestRpc<GuestCart>("guest_get_cart", { p_token }));
      return linesFromGuestCart(cart);
    },

    /**
     * الحفظ = مزامنة كميات، بندًا بندًا، عبر `guest_set_cart_item`.
     *
     * لماذا لا «احذف الكل ثم أدخل»؟ لأن الحذف الجماعي لم يعد متاحاً من
     * المتصفّح أصلاً (الجداول محجوبة)، ولأن الدالة تقبل الكمية صفراً بمعنى
     * الحذف — فالمزامنة تُعبَّر عنها بالوسائط نفسها بلا مسار ثانٍ.
     *
     * ولا `unit_price_fils` في أي استدعاء: الدالة تقرأ السعر من الرفّ. هذا
     * هو الموضع الذي كان المتصفّح يرسل فيه سعراً، ولم يعد.
     */
    async saveCart(lines: OrderLine[]): Promise<void> {
      if (!(await hasGuestSession())) return sessionScopedFallback.saveCart(lines);

      const ready = lines.filter((l) => l.kind === "ready" && l.id.startsWith("ready:"));
      if (ready.length === 0) {
        await withGuestToken((p_token) => guestRpc<GuestCart>("guest_clear_cart", { p_token }));
        return;
      }

      const wanted = new Map<string, number>();
      for (const line of ready) {
        const variantId = await variantIdForHandle(line.id.slice("ready:".length));
        if (variantId) wanted.set(variantId, line.quantity);
      }

      await withGuestToken(async (p_token) => {
        const current = await guestRpc<GuestCart>("guest_get_cart", { p_token });
        // ما في الخادم ولم يعد مطلوباً ⇒ كمية صفر (أي حذف).
        for (const item of current.items ?? []) {
          if (item.variant_id && !wanted.has(item.variant_id)) {
            await guestRpc("guest_set_cart_item", {
              p_token, p_variant_id: item.variant_id, p_quantity: 0,
            });
          }
        }
        for (const [p_variant_id, p_quantity] of wanted) {
          await guestRpc("guest_set_cart_item", { p_token, p_variant_id, p_quantity });
        }
      });
    },

    /**
     * طلب عطر مخصّص باسم الجلسة — بلا صف عميل وبلا هاتف. السعر من
     * `custom_price_fils` في القاعدة، والحالة `new` مفروضة هناك لا هنا.
     */
    async createCustomRequest(input: {
      bottleSize: string; catalogCode?: string; freeText?: string;
      quantity?: number; notes?: string; addToCart?: boolean;
    }): Promise<GuestCustomRequest> {
      return withGuestToken((p_token) =>
        guestRpc<GuestCustomRequest>("guest_create_custom_request", {
          p_token,
          p_bottle_size: input.bottleSize,
          p_catalog_code: input.catalogCode ?? null,
          p_free_text: input.catalogCode ? null : (input.freeText ?? null),
          p_quantity: input.quantity ?? 1,
          p_notes: input.notes ?? null,
          p_add_to_cart: input.addToCart ?? true,
        }));
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
    /**
     * طلبات العطر المخصّص لهذه الجلسة وحدها — `guest_list_custom_requests`
     * تحصرها بـ`guest_session_id`، فلا حاجة إلى تصفية بعد الوصول (ولا فائدة
     * منها: ما لا تُرجعه الدالة لا يصل أصلاً).
     */
    async listCustomPerfumeRequests(): Promise<CustomPerfumeRequestRow[]> {
      if (!(await hasGuestSession())) return [];
      const rows = await withGuestToken((p_token) =>
        guestRpc<GuestCustomRequest[]>("guest_list_custom_requests", { p_token }));
      return (rows ?? []).map((r) => ({
        id: r.request_id,
        customer_id: "",
        catalog_id: null,
        free_text_request: r.free_text_request ?? null,
        bottle_size: r.bottle_size,
        quantity: r.quantity,
        quoted_price_fils: r.quoted_price_fils,
        status: r.status,
        customer_notes: null,
        created_at: r.created_at ?? "",
      }));
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