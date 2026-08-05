/**
 * Journey C — the undecided customer.
 *
 * Three questions, skippable at every step, ending in a handful of picks that
 * each say WHY they were picked. Only available stock is ever recommended:
 * recommending something that cannot be bought is worse than recommending
 * nothing.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { useCart } from "@/lib/cart";
import { STAGING_PRICING_PLACEHOLDER } from "@/lib/pricing";
import { Async, Empty, PlaceholderPriceNote } from "@/components/states";

const QUESTIONS = [
  { key: "family", label: "أي جو تحب؟", options: [
    { value: "warm", label: "دافئ" }, { value: "fresh", label: "منعش" },
    { value: "sweet", label: "حلو" }, { value: "woody", label: "خشبي" }] },
  { key: "intensity", label: "قوة العطر؟", options: [
    { value: "1", label: "خفيف" }, { value: "2", label: "متوسط" }, { value: "3", label: "قوي" }] },
  { key: "budget", label: "الميزانية؟", options: [
    { value: "250", label: "أقل من ٢٥٠" }, { value: "320", label: "٢٥٠–٣٢٠" }, { value: "9999", label: "ما يهم" }] },
] as const;

export default function Discover() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const done = step >= QUESTIONS.length;
  const state = useAsync(() => repository.listProducts(), []);
  const navigate = useNavigate();
  const cart = useCart();

  const picks = useMemo(() => {
    if (!done || !state.data) return [];
    return state.data
      .filter((p) => p.is_available) // لا نرشّح ما لا يمكن شراؤه
      .map((p) => {
        let score = 0; const why: string[] = [];
        if (answers.family && p.family === answers.family) { score += 3; why.push("يطابق الجو اللي اخترته"); }
        if (answers.intensity && String(p.intensity) === answers.intensity) { score += 2; why.push("بنفس القوة اللي تحبها"); }
        if (answers.budget && p.price <= Number(answers.budget)) { score += 1; why.push("داخل ميزانيتك"); }
        if (why.length === 0) why.push("متوفر الآن — ترشيح عام لأنك تخطّيت الأسئلة");
        return { p, score, why };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [done, answers, state.data]);

  if (!done) {
    const q = QUESTIONS[step];
    return (
      <>
        <h1>نلقى لك عطرك</h1>
        <div className="stepbar" aria-hidden="true">
          {QUESTIONS.map((_, i) => <span key={i} className={`step ${i <= step ? "on" : ""}`} />)}
        </div>
        <p className="tiny muted">سؤال {step + 1} من {QUESTIONS.length}</p>
        <h2>{q.label}</h2>
        <div className="grid two">
          {q.options.map((o) => (
            <button key={o.value} className="btn ghost"
              onClick={() => { setAnswers((a) => ({ ...a, [q.key]: o.value })); setStep((s) => s + 1); }}>
              {o.label}
            </button>
          ))}
        </div>
        <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setStep((s) => s + 1)}>تخطَّ هذا السؤال</button>
      </>
    );
  }

  return (
    <>
      <h1>ترشيحاتنا لك</h1>
      <Async state={state}>
        {() =>
          picks.length === 0 ? (
            <Empty title="ما عندنا شي متوفر يناسب اختيارك الحين" hint="جرّب العطر المخصص."
              action={<Link className="btn" to="/custom" style={{ display: "inline-block", maxWidth: 240, marginTop: 12 }}>صمّم عطرك</Link>} />
          ) : (
            <div className="grid">
              {picks.map(({ p, why }) => {
                const quote = STAGING_PRICING_PLACEHOLDER.quoteReadyMade(p.price);
                return (
                  <div key={p.handle} className="card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <Link to={`/product/${p.handle}`}><strong>{p.title}</strong></Link>
                      <span style={{ fontWeight: 700 }}>{STAGING_PRICING_PLACEHOLDER.format(quote.unitPrice)}</span>
                    </div>
                    {/* السبب معروض دائماً — الترشيح بلا تعليل لا يُقنع أحداً */}
                    <p className="tiny muted" style={{ margin: "6px 0 0" }}>ليش رشّحناه: {why.join(" · ")}</p>
                    <button className="btn" style={{ marginTop: 10 }}
                      onClick={() => {
                        cart.add({ id: `ready:${p.handle}`, kind: "ready", title: p.title, unitPrice: quote.unitPrice });
                        navigate("/cart");
                      }}>
                      أضف للسلة
                    </button>
                  </div>
                );
              })}
              <PlaceholderPriceNote />
            </div>
          )
        }
      </Async>
      <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => { setStep(0); setAnswers({}); }}>ابدأ من جديد</button>
    </>
  );
}
