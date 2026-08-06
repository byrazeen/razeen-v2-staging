/**
 * One cart for both journeys. The production split — a Zustand store for
 * ready-made perfumes and local component state for custom ones — is what cost
 * the custom flow its coupons, its shipping, its persistence and its recovery.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { totals as pricingTotals, isPurchasable, type Totals } from "@/lib/pricing";
import type { OrderLine } from "@/data/repository";

/** سطر السلة هو نفسه سطر الطلب — شكل واحد من السلة إلى لوحة الإدارة. */
export type CartLine = OrderLine;

interface CartApi {
  lines: CartLine[];
  add(line: Omit<CartLine, "quantity"> & { quantity?: number }): void;
  remove(id: string): void;
  setQuantity(id: string, quantity: number): void;
  clear(): void;
  count: number;
  /** المجاميع كلها من مصدر التسعير الوحيد — السلة لا تحسب رقماً بنفسها. */
  totals: Totals;
}

const Ctx = createContext<CartApi | null>(null);

/** السلة تبقى بعد إعادة التحميل — فقدان السلة عند التحديث سبب مباشر لهجر الطلب. */
const STORAGE_KEY = "razeen_v2_staging_cart_v2";

function restore(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch { return []; }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(restore);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines)); } catch { /* تخزين غير متاح */ }
  }, [lines]);

  const api = useMemo<CartApi>(() => ({
    lines,
    // سطر بلا سعر صالح لا يدخل السلة إطلاقاً — القاعدة 2 من سياسة التسعير.
    add: (line) => {
      if (!isPurchasable(line.unitPriceFils)) return;
      setLines((prev) => {
        const existing = prev.find((l) => l.id === line.id);
        if (existing) {
          return prev.map((l) => (l.id === line.id ? { ...l, quantity: l.quantity + (line.quantity ?? 1) } : l));
        }
        return [...prev, { ...line, quantity: line.quantity ?? 1 }];
      });
    },
    remove: (id) => setLines((prev) => prev.filter((l) => l.id !== id)),
    setQuantity: (id, quantity) =>
      setLines((prev) =>
        quantity <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, quantity } : l))
      ),
    clear: () => setLines([]),
    // العدّ يطابق ما يُحتسب فعلاً. سطر بلا سعر صالح لا يدخل السلة عبر `add`،
    // لكنه قد يصل من تخزين محلي مُعدَّل — وحينها كان الشارة تقول «7» بينما
    // المجاميع تحسب اثنين. المال كان صحيحاً والعدد كاذباً، والرقمان يُقرآن معاً.
    count: lines.reduce((n, l) => (isPurchasable(l.unitPriceFils) ? n + l.quantity : n), 0),
    totals: pricingTotals(lines),
  }), [lines]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
