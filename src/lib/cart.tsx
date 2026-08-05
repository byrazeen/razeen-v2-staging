/**
 * One cart for both journeys. The production split — a Zustand store for
 * ready-made perfumes and local component state for custom ones — is what cost
 * the custom flow its coupons, its shipping, its persistence and its recovery.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface CartLine {
  id: string;
  kind: "ready" | "custom";
  title: string;
  subtitle?: string;
  unitPrice: number;
  quantity: number;
  isPlaceholderPrice?: boolean;
}

interface CartApi {
  lines: CartLine[];
  add(line: Omit<CartLine, "quantity"> & { quantity?: number }): void;
  remove(id: string): void;
  setQuantity(id: string, quantity: number): void;
  clear(): void;
  count: number;
  subtotal: number;
}

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

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
    subtotal: lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0),
  }), [lines]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
