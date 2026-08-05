/**
 * Journey B — the custom perfume.
 *
 * Three things the live flow gets wrong are fixed here by construction:
 *   • the price shown is the price carried into the cart, one source only;
 *   • "لم أجد عطري" is a first-class path, not a dead end that pushes the
 *     customer into WhatsApp and out of the system;
 *   • size is chosen, not hardcoded to 100ml.
 * The number itself is a placeholder and is labelled as one everywhere.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BOTTLE_SIZES, type BottleSize, type CustomOil } from "@/data/mock";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { search } from "@/lib/search";
import { STAGING_PRICING_PLACEHOLDER } from "@/lib/pricing";
import { useCart } from "@/lib/cart";
import { Async, PlaceholderPriceNote } from "@/components/states";

const asSearchable = (o: CustomOil) => ({ title: `${o.brand} ${o.name}`, aliases: [o.name, o.brand, o.code] });

export default function CustomPerfume() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cart = useCart();
  const state = useAsync(() => repository.listOils(), []);

  const [q, setQ] = useState(params.get("q") ?? "");
  const [picked, setPicked] = useState<CustomOil | null>(null);
  /** المسار البديل: العميل ما لقى عطره فيكتبه بنفسه. */
  const [unlisted, setUnlisted] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [size, setSize] = useState<BottleSize>("100ml");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const oils = state.data ?? [];
  const suggestions = useMemo(() => {
    if (!q.trim()) return [];
    return search(q, oils.map((o) => ({ ...o, ...asSearchable(o) })), 8) as unknown as CustomOil[];
  }, [q, oils]);

  const quote = picked
    ? STAGING_PRICING_PLACEHOLDER.quoteCustom(picked.kilo_price, size)
    : STAGING_PRICING_PLACEHOLDER.quoteUnlistedCustom();
  const requestedName = picked ? `${picked.brand} — ${picked.name}` : freeText.trim();
  const chosen = Boolean(picked || (unlisted && freeText.trim()));
  const step = chosen ? 2 : 1;

  return (
    <>
      <h1>صمّم عطرك الخاص</h1>
      <div className="stepbar" aria-hidden="true">
        <span className={`step ${step >= 1 ? "on" : ""}`} /><span className={`step ${step >= 2 ? "on" : ""}`} />
      </div>

      <label htmlFor="oil" className="small muted">اكتب اسم العطر أو البراند</label>
      <input id="oil" className="field" value={q} placeholder="مثال: MIDNIGHT FIG أو BRAND ALPHA"
        onChange={(e) => { setQ(e.target.value); setPicked(null); }} style={{ marginTop: 6 }} />

      <Async state={state} loadingLabel="جاري تحميل قائمة الزيوت…">
        {() => (
          <>
            {q.trim() && !picked && !unlisted && (
              <div className="grid" style={{ marginTop: 10 }} data-testid="suggestions">
                {suggestions.map((o) => (
                  <button key={o.code} className="card" style={{ textAlign: "start", cursor: "pointer" }}
                    onClick={() => { setPicked(o); setUnlisted(false); setFreeText(""); }}>
                    <strong>{o.name}</strong>
                    <span className="tiny muted" style={{ display: "block" }}>{o.brand} · {o.code}</span>
                  </button>
                ))}
                {suggestions.length === 0 && <p className="tiny muted">ما في اقتراح مطابق.</p>}

                {/* لا طريق مسدود: العطر غير الموجود يُسجَّل كطلب بدل خروج العميل */}
                <button className="btn ghost" onClick={() => { setUnlisted(true); setFreeText(q); }}>لم أجد عطري</button>
              </div>
            )}

            {unlisted && !picked && (
              <div className="card" style={{ marginTop: 10 }}>
                <strong className="small">اكتب عطرك بنفسك</strong>
                <p className="tiny muted" style={{ margin: "4px 0 8px" }}>نسجّله كطلب خاص ونرجع لك بالتوفر والسعر.</p>
                <input className="field" value={freeText} onChange={(e) => setFreeText(e.target.value)}
                  placeholder="اسم العطر والبراند كما تعرفه" />
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => { setUnlisted(false); setFreeText(""); }}>رجوع للاقتراحات</button>
              </div>
            )}

            {chosen && (
              <>
                <div className="card" style={{ marginTop: 14 }}>
                  <strong>{requestedName}</strong>
                  {picked
                    ? <span className="tiny muted" style={{ display: "block" }}>كود الزيت: {picked.code}</span>
                    : <span className="tiny muted" style={{ display: "block" }}>طلب خاص — يحتاج تأكيد التوفر</span>}
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
                    <strong style={{ fontSize: 20 }} data-testid="custom-price">
                      {picked ? STAGING_PRICING_PLACEHOLDER.format(quote.unitPrice * quantity) : "يُسعَّر بعد التأكيد"}
                    </strong>
                  </div>
                  <PlaceholderPriceNote />
                </div>

                <button className="btn" style={{ marginTop: 14 }} disabled={!requestedName}
                  onClick={() => {
                    cart.add({
                      id: `custom:${picked?.code ?? "unlisted"}:${size}:${requestedName}`,
                      kind: "custom",
                      title: requestedName,
                      subtitle: `${size}${notes ? ` · ${notes}` : ""}`,
                      unitPrice: quote.unitPrice,
                      quantity,
                      perfumeCode: picked?.code,
                      size,
                      isPlaceholderPrice: true,
                    });
                    navigate("/cart");
                  }}>
                  أضف للسلة
                </button>
              </>
            )}
          </>
        )}
      </Async>
    </>
  );
}
