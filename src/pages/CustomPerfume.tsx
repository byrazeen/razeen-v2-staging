/**
 * Journey B — the custom perfume prototype.
 *
 * Three things the live flow gets wrong are fixed here by construction:
 *   • the price shown is the price carried into the cart, one source only;
 *   • "I can't find my perfume" is a first-class path, not a dead end that
 *     pushes the customer into WhatsApp and out of the system;
 *   • size is chosen, not hardcoded to 100ml.
 * The number itself is a placeholder and is labelled as one everywhere.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { customOils, BOTTLE_SIZES, type BottleSize } from "@/data/mock";
import { search } from "@/lib/search";
import { quoteCustomPerfumePlaceholder } from "@/lib/pricing";
import { useCart } from "@/lib/cart";

type Oil = (typeof customOils)[number];
const asSearchable = (o: Oil) => ({ title: `${o.brand} ${o.name}`, aliases: [o.name, o.brand, o.code] });

export default function CustomPerfume() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cart = useCart();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [picked, setPicked] = useState<Oil | null>(null);
  const [freeText, setFreeText] = useState("");
  const [size, setSize] = useState<BottleSize>("100ml");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const suggestions = useMemo(() => {
    if (!q.trim()) return [];
    const hits = search(q, customOils.map((o) => ({ ...o, ...asSearchable(o) })), 8);
    return hits as unknown as Oil[];
  }, [q]);

  const quote = useMemo(
    () => (picked ? quoteCustomPerfumePlaceholder(picked.kilo_price, size, quantity) : null),
    [picked, size, quantity]
  );
  const requestedName = picked ? `${picked.brand} — ${picked.name}` : freeText.trim();
  const step = picked || freeText.trim() ? 2 : 1;

  return (
    <>
      <h1>صمّم عطرك الخاص</h1>
      <div className="stepbar" aria-hidden="true">
        <span className={`step ${step >= 1 ? "on" : ""}`} /><span className={`step ${step >= 2 ? "on" : ""}`} />
      </div>

      <label htmlFor="oil" className="small muted">اكتب اسم العطر أو البراند</label>
      <input id="oil" className="field" value={q} placeholder="مثال: MIDNIGHT FIG أو BRAND ALPHA"
        onChange={(e) => { setQ(e.target.value); setPicked(null); }} style={{ marginTop: 6 }} />

      {q.trim() && !picked && (
        <div className="grid" style={{ marginTop: 10 }}>
          {suggestions.map((o) => (
            <button key={o.code} className="card" style={{ textAlign: "start", cursor: "pointer" }}
              onClick={() => { setPicked(o); setFreeText(""); }}>
              <strong>{o.name}</strong>
              <span className="tiny muted" style={{ display: "block" }}>{o.brand} · {o.code}</span>
            </button>
          ))}

          {/* لا طريق مسدود: العطر غير الموجود يُسجَّل كطلب بدل خروج العميل */}
          <div className="card">
            <strong className="small">ما لقيت عطرك؟</strong>
            <p className="tiny muted" style={{ margin: "4px 0 8px" }}>اكتبه بنفسك ونرجع لك.</p>
            <input className="field" value={freeText} onChange={(e) => setFreeText(e.target.value)}
              placeholder="اسم العطر والبراند كما تعرفه" />
          </div>
        </div>
      )}

      {(picked || freeText.trim()) && (
        <>
          <div className="card" style={{ marginTop: 14 }}>
            <strong>{requestedName}</strong>
            {picked && <span className="tiny muted" style={{ display: "block" }}>كود الزيت: {picked.code}</span>}
            {!picked && <span className="tiny muted" style={{ display: "block" }}>طلب خاص — يحتاج تأكيد التوفر</span>}
          </div>

          <h2>الحجم</h2>
          <div className="grid two">
            {BOTTLE_SIZES.map((s) => (
              <button key={s} className={`btn ${size === s ? "" : "ghost"}`} onClick={() => setSize(s)}>{s}</button>
            ))}
          </div>

          <h2>الكمية</h2>
          <div className="row">
            <button className="icon-btn" aria-label="أنقص" onClick={() => setQuantity((n) => Math.max(1, n - 1))}>−</button>
            <span style={{ minWidth: 32, textAlign: "center", fontWeight: 700 }}>{quantity}</span>
            <button className="icon-btn" aria-label="زد" onClick={() => setQuantity((n) => Math.min(20, n + 1))}>+</button>
          </div>

          <h2>ملاحظات (اختياري)</h2>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي تفصيل يهمك" />

          <div className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">السعر</span>
              <strong style={{ fontSize: 20 }}>{quote ? `${quote.unitPrice * quantity} د.إ` : "—"}</strong>
            </div>
            <span className="placeholder-price">{quote ? quote.note : "طلب خاص — يُسعَّر بعد التأكيد"}</span>
          </div>

          <button className="btn" style={{ marginTop: 14 }} disabled={!requestedName}
            onClick={() => {
              cart.add({
                id: `custom:${picked?.code ?? "freetext"}:${size}:${requestedName}`,
                kind: "custom",
                title: requestedName,
                subtitle: `${size}${notes ? ` · ${notes}` : ""}`,
                unitPrice: quote?.unitPrice ?? 0,
                quantity,
                isPlaceholderPrice: true,
              });
              navigate("/cart");
            }}>
            أضف للسلة
          </button>
        </>
      )}
    </>
  );
}
