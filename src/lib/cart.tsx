/**
 * One cart for both journeys. The production split — a Zustand store for
 * ready-made perfumes and local component state for custom ones — is what cost
 * the custom flow its coupons, its shipping, its persistence and its recovery.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { STAGING_PRICING_PLACEHOLDER, type Totals } from "@/lib/pricing";
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
  subtotal: number;
  /** المجاميع كلها من مصدر التسعير الوحيد. */
  totals: Totals;
}

const Ctx = createContext<CartApi | null>(null);

/** السلة تبقى بعد إعادة التحميل — فقدان السلة عند التحديث سبب مباشر لهجر الطلب. */
const STORAGE_KEY = "razeen_v2_staging_cart";

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
    add: (line) =>
      setLines((prev) => {
        const existing = prev.find((l) => l.id === line.id);
        if (existing) {
          return prev.map((l) => (l.id === line.id ? { ...l, quantity: l.quantity + (line.quantity ?? 1) } : l));
        }
        return [...prev, { ...line, quantity: line.quantity ?? 1 }];
      }),
    remove: (id) => setLines((prev) => prev.filter((l) => l.id !== id)),
    setQuantity: (id, quantity) =>
      setLines((prev) =>
        quantity <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, quantity } : l))
      ),
    clear: () => setLines([]),
    count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: STAGING_PRICING_PLACEHOLDER.totals(lines).subtotal,
    totals: STAGING_PRICING_PLACEHOLDER.totals(lines),
  }), [lines]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
