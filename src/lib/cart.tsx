/**
 * One cart for both journeys. The production split — a Zustand store for
 * ready-made perfumes and local component state for custom ones — is what cost
 * the custom flow its coupons, its shipping, its persistence and its recovery.
 *
 * وأين تعيش السلة الآن؟ **في القاعدة، تحت جلسة المتصفّح المجهولة.**
 *
 * وهذا فرق في المرجعية لا في مكان التخزين: `localStorage` بقي، لكنه صار
 * ذاكرةً عابرة للرسم الأول وحده. الترتيب مكتوب صراحةً أدناه:
 *   ١) تُرسَم النسخة المحفوظة فوراً كي لا يرى العميل سلةً فارغة للحظة؛
 *   ٢) ثم تُقرأ السلة من القاعدة، **وما يعود منها يستبدل المرسوم**؛
 *   ٣) ولا دمج ولا مصالحة ولا «الأحدث يفوز». الخادم يفوز، دائماً.
 *
 * مع حدٍّ واحد معلن (مشروح في `supabaseRepository.saveCart`): البند المخصص
 * لا يُكتب في `cart_items` قبل وجود صف عميل — والصف يحتاج هاتفاً حقيقياً لا
 * يُعرف قبل إتمام الطلب. فالبنود المخصصة تُنشأ خادمياً داخل `place_order`،
 * وتبقى قبله في هذه النسخة العابرة وحدها.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { repository } from "@/data/repository";
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

/**
 * مفتاح **الذاكرة العابرة** لا مفتاح المصدر. اسمه يقول ذلك كي لا يُقرأ يوماً
 * على أنه مخزن السلة.
 */
const CACHE_KEY = "razeen_v2_staging_cart_cache";

/** النسخة المحفوظة — للرسم الأول فقط، ويستبدلها الخادم بمجرد أن يردّ. */
function readCache(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch { return []; }
}

function writeCache(lines: CartLine[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(lines)); } catch { /* تخزين غير متاح */ }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readCache);
  /** هل وصلت قراءة الخادم؟ قبلها لا تُكتب سلة إلى الخادم كي لا تُمحى الحقيقية. */
  const hydrated = useRef(false);

  // ١+٢: الخادم هو المصدر. ما يعود منه يستبدل المرسوم.
  useEffect(() => {
    let alive = true;
    repository.loadCart()
      .then((serverLines) => {
        if (!alive) return;
        setLines((cached) => {
          // البنود المخصصة لا تُخزَّن خادمياً قبل وجود عميل (انظر رأس الملف).
          // وكل ما يعرفه الخادم يغلب ما في النسخة العابرة.
          const custom = cached.filter((l) => l.kind === "custom");
          const next = [...serverLines, ...custom];
          writeCache(next);
          return next;
        });
      })
      .catch((error) => { console.error("cart load failed", error); })
      .finally(() => { if (alive) hydrated.current = true; });
    return () => { alive = false; };
  }, []);

  // كل تغيير يُكتب إلى الخادم، والنسخة العابرة تتبعه — لا العكس.
  useEffect(() => {
    writeCache(lines);
    if (!hydrated.current) return;
    repository.saveCart(lines).catch((error) => { console.error("cart save failed", error); });
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
    // لكنه قد يصل من ذاكرة عابرة مُعدَّلة — وحينها كانت الشارة تقول «7» بينما
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
