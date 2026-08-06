/**
 * Journey B — the custom perfume.
 *
 * Three things the live flow gets wrong are fixed here by construction:
 *   • the price shown is the price carried into the cart, one source only;
 *   • "لم أجد عطري" is a first-class path, not a dead end that pushes the
 *     customer into WhatsApp and out of the system;
 *   • size is chosen, not hardcoded to 100ml.
 *
 * وعيبان كانا باقيين:
 *   • الصفحة كانت تفتح على حقل نصّ وحيد و«اكتب حرفين وتظهر الاقتراحات». من يريد
 *     عطراً مخصصاً ولا يحفظ اسم زيت لا يملك خطوة تالية، وعند 1440 بكسل كان
 *     الحقل يطفو وحده في نحو 500 بكسل من بطاقة فارغة. الحالة الافتراضية الآن
 *     شبكة الزيوت الفعلية من الكتالوج، والبحث يبقى فوقها لمن يعرف اسمه.
 *   • أزرار المقاس كانت «50ml» و«100ml» بلا سعر، والسعر الوحيد أسفل الطيّة:
 *     يختار العميل ثم يعرف كم يكلّف. السعر صار على الزرّ نفسه — مقروءاً من وحدة
 *     التسعير كما هو، بلا حساب هنا.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BOTTLE_SIZES, type BottleSize, type CustomOil } from "@/data/mock";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { search } from "@/lib/search";
import { customPriceFils, formatFils, lineTotalFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { useCart } from "@/lib/cart";
import { Async } from "@/components/states";
import { Iso } from "@/components/text";
import { Media } from "@/components/Media";

const asSearchable = (o: CustomOil) => ({ title: `${o.brand} ${o.name}`, aliases: [o.name, o.brand, o.code] });

export default function CustomPerfume() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cart = useCart();
  const state = useAsync(() => repository.listOils(), [], { cacheKey: "oils" });

  const [q, setQ] = useState(params.get("q") ?? "");
  const [picked, setPicked] = useState<CustomOil | null>(null);
  /** المسار البديل: العميل ما لقى عطره فيكتبه بنفسه. */
  const [unlisted, setUnlisted] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [size, setSize] = useState<BottleSize>("100ml");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const oils = state.data ?? [];
  /** بلا بحث: الكتالوج كله معروضاً. مع بحث: ما يطابقه. لا شاشة فارغة أبداً. */
  const shown = useMemo(() => {
    if (!q.trim()) return oils;
    return search(q, oils.map((o) => ({ ...o, ...asSearchable(o) })), 8) as unknown as CustomOil[];
  }, [q, oils]);

  /** 50ml = 280 درهم، 100ml = 320 درهم. أي مقاس آخر غير قابل للشراء. */
  const sizePriceFils = customPriceFils(size);
  /** العطر غير المدرج يحتاج تأكيد توفر قبل التسعير — لا يُسعَّر ولا يُضاف. */
  const unitPriceFils = picked ? sizePriceFils : null;
  const requestedName = picked ? `${picked.brand} — ${picked.name}` : freeText.trim();
  const chosen = Boolean(picked || (unlisted && freeText.trim()));
  const step = chosen ? 2 : 1;

  return (
    <>
      <h1>صمّم عطرك الخاص</h1>
      <p className="lede">اختر العطر ثم الحجم. السعر الذي تراه هنا هو نفسه الذي يدخل السلة.</p>
      <div className="stepbar" aria-hidden="true">
        <span className={`step ${step >= 1 ? "on" : ""}`} /><span className={`step ${step >= 2 ? "on" : ""}`} />
      </div>
      {/* الشريط مخفي عن القارئ ولم يكن له مقابل نصّي — /discover كان يفعلها وحده. */}
      <p className="tiny muted">الخطوة {step} من 2</p>

      <label htmlFor="oil" className="small muted" style={{ marginTop: 14 }}>ابحث في الزيوت — أو اختر من الشبكة</label>
      <input id="oil" className="field" value={q} placeholder="مثال: MIDNIGHT FIG أو BRAND ALPHA"
        onChange={(e) => { setQ(e.target.value); setPicked(null); }} style={{ marginTop: 6 }} />

      <Async state={state} loadingLabel="جاري تحميل قائمة الزيوت…">
        {() => (
          <>
            {!picked && !unlisted && (
              <>
                <h2 className="eyebrow">{q.trim() ? "نتائج البحث" : "الزيوت المتاحة"}</h2>
                <div className="oil-grid" data-testid="suggestions">
                  {shown.map((o) => (
                    <button key={o.code} className="oil-card"
                      onClick={() => { setPicked(o); setUnlisted(false); setFreeText(""); }}>
                      <Media label={o.name} />
                      <span className="oil-name">{o.name}</span>
                      <span className="oil-sub"><Iso>{o.brand}</Iso></span>
                      <span className="oil-sub"><Iso className="num">{o.code}</Iso></span>
                    </button>
                  ))}
                  {/* لا طريق مسدود: العطر غير الموجود يُسجَّل كطلب بدل خروج العميل */}
                  <button className="oil-card oil-alt" onClick={() => { setUnlisted(true); setFreeText(q); }}>
                    <span className="oil-plate" aria-hidden="true">+</span>
                    <span className="oil-name">لم أجد عطري</span>
                    <span className="oil-sub">نسجّله كطلب خاص</span>
                  </button>
                </div>
                {q.trim() && shown.length === 0 && (
                  <p className="tiny muted" style={{ marginTop: 10 }}>ما في زيت مطابق لبحثك — سجّله كطلب خاص.</p>
                )}
              </>
            )}

            {unlisted && !picked && (
              <div className="card" style={{ marginTop: 14 }}>
                <strong className="small">اكتب عطرك بنفسك</strong>
                <p className="tiny muted" style={{ margin: "4px 0 8px" }}>نسجّله كطلب خاص ونرجع لك بالتوفر والسعر.</p>
                <input className="field" value={freeText} onChange={(e) => setFreeText(e.target.value)}
                  placeholder="اسم العطر والبراند كما تعرفه" />
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => { setUnlisted(false); setFreeText(""); }}>رجوع للزيوت</button>
              </div>
            )}

            {chosen && (
              <>
                <div className="card row" style={{ marginTop: 14, gap: 14 }}>
                  <Media size="thumb" label={requestedName} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ display: "block" }}>{requestedName}</strong>
                    {picked
                      ? <span className="tiny muted">كود الزيت: <Iso className="num">{picked.code}</Iso></span>
                      : <span className="tiny muted">طلب خاص — يحتاج تأكيد التوفر</span>}
                  </span>
                  {picked && (
                    <button className="icon-btn" onClick={() => { setPicked(null); }}>غيّر</button>
                  )}
                </div>

                <h2 className="eyebrow" id="size-label">الحجم</h2>
                {/* الاختيار كان لوناً فقط: «50ml، زر» سواء اختير أم لا. والسعر كان غائباً
                    عن الأزرار كلها: يُقرأ الآن من وحدة التسعير ويُعرض على الزرّ نفسه. */}
                <div className="sizes" role="radiogroup" aria-labelledby="size-label">
                  {BOTTLE_SIZES.map((s) => {
                    const priceFils = customPriceFils(s);
                    const available = priceFils !== null;
                    return (
                      <button key={s} role="radio" aria-checked={size === s}
                        className={`btn ${size === s ? "sel" : "ghost"}`} disabled={!available}
                        onClick={() => setSize(s)}>
                        <Iso className="num">{s}</Iso>
                        <span className="size-price">
                          {available ? formatFils(priceFils) : UNAVAILABLE_LABEL}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <h2 className="eyebrow" id="qty-label">الكمية</h2>
                <div className="row" role="group" aria-labelledby="qty-label">
                  <button className="icon-btn" aria-label="أنقص" onClick={() => setQuantity((n) => Math.max(1, n - 1))}>−</button>
                  <span style={{ minWidth: 32, textAlign: "center", fontWeight: 700 }}>{quantity}</span>
                  <button className="icon-btn" aria-label="زد" onClick={() => setQuantity((n) => Math.min(20, n + 1))}>+</button>
                </div>

                <h2 className="eyebrow">ملاحظات (اختياري)</h2>
                <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي تفصيل يهمك" aria-label="ملاحظات على الطلب" />

                <div className="panel" style={{ marginTop: 18 }}>
                  <div className="sum total" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
                    <span>الإجمالي</span>
                    {unitPriceFils === null
                      ? <strong className="price-na" data-testid="custom-price">{picked ? UNAVAILABLE_LABEL : "يُسعَّر بعد التأكيد"}</strong>
                      : <strong className="price price-lg" data-testid="custom-price">{formatFils(lineTotalFils({ unitPriceFils, quantity }))}</strong>}
                  </div>
                </div>

                <div className="actionbar">
                <button className="btn" disabled={!requestedName || unitPriceFils === null}
                  data-testid="custom-add"
                  onClick={() => {
                    if (unitPriceFils === null) return;
                    cart.add({
                      id: `custom:${picked?.code ?? "unlisted"}:${size}:${requestedName}`,
                      kind: "custom",
                      title: requestedName,
                      subtitle: `${size}${notes ? ` · ${notes}` : ""}`,
                      unitPriceFils,
                      quantity,
                      perfumeCode: picked?.code,
                      size,
                    });
                    navigate("/cart");
                  }}>
                  {unitPriceFils === null ? UNAVAILABLE_LABEL : "أضف للسلة"}
                </button>
                </div>
              </>
            )}
          </>
        )}
      </Async>
    </>
  );
}
