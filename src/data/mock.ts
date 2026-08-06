/**
 * Staging catalogue. Every record is invented — no production row, no real
 * customer, no real phone. Titles carry [STG] so a screenshot can never be
 * mistaken for the live store.
 */
import seed from "../../seed/seed.json";

export interface Product {
  handle: string; title: string;
  /**
   * السعر المخزَّن للمقاس المعروض، بالفلس الصحيح — كما هو في
   * `product_variants.price_fils`. `null` = لا سعر صالح ⇒ غير قابل للشراء.
   */
  priceFils: number | null;
  currency: string;
  quantity: number; is_available: boolean; is_vip: boolean;
  /** Search aliases: how a customer might name the perfume they already know. */
  aliases?: string[];
  family?: "warm" | "fresh" | "sweet" | "woody";
  intensity?: 1 | 2 | 3;
}

export interface CustomOil { code: string; brand: string; name: string; kilo_price: number; }

const EXTRA: Record<string, Partial<Product>> = {
  "stg-amber-oud":   { aliases: ["عنبر", "عود", "amber", "oud"],        family: "warm",  intensity: 3 },
  "stg-citrus-dawn": { aliases: ["حمضي", "ليمون", "citrus", "fresh"],   family: "fresh", intensity: 1 },
  "stg-velvet-rose": { aliases: ["ورد", "روز", "rose", "velvet"],       family: "sweet", intensity: 2 },
  "stg-royal-musk":  { aliases: ["مسك", "musk", "royal"],               family: "woody", intensity: 2 },
};

/** البذرة تحمل السعر بالدرهم؛ يُحوَّل مرة واحدة إلى الفلس الصحيح ولا يُشتق بعدها. */
type SeedProduct = Omit<Product, "priceFils"> & { price: number };
export const products: Product[] = (seed.products as unknown as SeedProduct[]).map(({ price, ...p }) => ({
  ...p,
  priceFils: Number.isFinite(price) ? Math.round(price * 100) : null,
  ...EXTRA[p.handle],
}));
export const customOils: CustomOil[] = seed.custom_oils as CustomOil[];
export const BOTTLE_SIZES = ["50ml", "100ml", "200ml"] as const;
export type BottleSize = (typeof BOTTLE_SIZES)[number];
