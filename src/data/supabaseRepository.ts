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
 * لذلك يأخذ هذا التنفيذ `sessionScopedFallback`: مسار الطلب كله يعمل على
 * المخزن المحلي، بدل أن يعيد قائمة فارغة صامتة أو يرمي خطأ RLS في وجه
 * العميل. هذا القرار مكتوب هنا صراحةً لا مخبّأ في شرط.
 *
 * والعميل هنا `PostgrestClient` وحده لا مظلّة `supabase-js`: التطبيق لا
 * يستعمل غير `.from()`، فراجع `@/lib/supabaseClient` لتفصيل ما حُذف ولماذا.
 *
 * Reads use the publishable (anon) key and therefore go through RLS. The public
 * shelf is genuinely live. Everything order-shaped requires an authenticated
 * session under 0002_rls.sql and this storefront has no sign-in at all, so the
 * order lifecycle is served by the explicitly injected local fallback.
 */
import type { CustomOil, Product } from "@/data/mock";
import type { RazeenRepository } from "@/data/repositoryContract";
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
}

export interface SupabaseRepositoryDeps {
  client: RazeenPostgrestClient;
  /**
   * مسار الطلب حين لا توجد جلسة. RLS يمنع anon من كل جداول الطلب، فالبديل
   * صريح ومحقون بدل شرط مخبّأ داخل كل دالة.
   */
  sessionScopedFallback: RazeenRepository;
}

export function createSupabaseRepository({ client, sessionScopedFallback }: SupabaseRepositoryDeps): SupabaseDataSurface {
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
    // ---------------------------------------------------------------------
    // مسار الطلب — anon لا يراه أصلاً، فيبقى كله على المخزن المحقون.
    //
    // كل جداول الطلب ممنوعة على anon تحت 0002_rls.sql، ولا شاشة في هذا
    // المتجر تسجّل الدخول: لا `signIn` ولا `signUp` في أي ملف. فالسؤال
    // «هل توجد جلسة؟» كان جوابه `null` دائماً، وكل استدعاء كان ينتهي عند
    // البديل المحقون على أي حال — بينما كان يجرّ `@supabase/auth-js`
    // (413 kB من المصدر) إلى حزمة العميل. حُذف السؤال وبقي جوابه الوحيد.
    // يوم يوجد تسجيل دخول، يعود مسار Supabase من تاريخ git كما كُتب.
    // ---------------------------------------------------------------------
    listOrders: (...args) => sessionScopedFallback.listOrders(...args),
    getOrder: (...args) => sessionScopedFallback.getOrder(...args),
    listProductionQueue: (...args) => sessionScopedFallback.listProductionQueue(...args),
    createOrder: (...args) => sessionScopedFallback.createOrder(...args),
    setPaymentStatus: (...args) => sessionScopedFallback.setPaymentStatus(...args),
    setProductionStatus: (...args) => sessionScopedFallback.setProductionStatus(...args),
    setShippingStatus: (...args) => sessionScopedFallback.setShippingStatus(...args),
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