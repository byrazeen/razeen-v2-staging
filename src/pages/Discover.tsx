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
import { formatFils, readyMadePriceFils, UNAVAILABLE_LABEL, FILS_PER_AED } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";
import { Media } from "@/components/Media";

const QUESTIONS = [
  { key: "family", label: "أي جو تحب؟", options: [
    { value: "warm", label: "دافئ" }, { value: "fresh", label: "منعش" },
    { value: "sweet", label: "حلو" }, { value: "woody", label: "خشبي" }] },
  { key: "intensity", label: "قوة العطر؟", options: [
    { value: "1", label: "خفيف" }, { value: "2", label: "متوسط" }, { value: "3", label: "قوي" }] },
  { key: "budget", label: "الميزانية؟", options: [
    // أرقام غربية كالأسعار في كل الواجهة — الخلط بين النظامين في شاشة واحدة يربك القراءة.
    { value: "250", label: "أقل من 250" }, { value: "320", label: "250–320" }, { value: "9999", label: "ما يهم" }] },
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
      .filter((p) => p.is_available && readyMadePriceFils(p.priceFils) !== null) // لا نرشّح ما لا يمكن شراؤه
      .map((p) => {
        let score = 0; const why: string[] = [];
        if (answers.family && p.family === answers.family) { score += 3; why.push("يطابق الجو اللي اخترته"); }
        if (answers.intensity && String(p.intensity) === answers.intensity) { score += 2; why.push("بنفس القوة اللي تحبها"); }
        if (answers.budget && (p.priceFils ?? Infinity) <= Number(answers.budget) * FILS_PER_AED) { score += 1; why.push("داخل ميزانيتك"); }
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
        <p className="lede">ثلاثة أسئلة، وكل سؤال يمكن تخطّيه. لا نرشّح إلا ما هو متوفر الآن.</p>
        <div className="stepbar" aria-hidden="true">
          {QUESTIONS.map((_, i) => <span key={i} className={`step ${i <= step ? "on" : ""}`} />)}
        </div>
        <p className="tiny muted">سؤال {step + 1} من {QUESTIONS.length}</p>
        <h2 style={{ marginTop: 18 }}>{q.label}</h2>
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
            <Empty title="ما عندنا شي متوفر يناسب اختيارك الحين" hint="جرّب العطر المخصص." headingLevel={2}
              action={<Link className="btn" to="/custom" style={{ display: "inline-block", maxWidth: 240, marginTop: 12 }}>صمّم عطرك</Link>} />
          ) : (
            <div className="grid list-2">
              {picks.map(({ p, why }) => {
                const priceFils = readyMadePriceFils(p.priceFils);
                return (
                  <div key={p.handle} className="card">
                    <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                      <Media size="thumb" label={p.title} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <Link to={`/product/${p.handle}`}><strong style={{ display: "block" }}>{p.title}</strong></Link>
                        {/* السبب معروض دائماً — الترشيح بلا تعليل لا يُقنع أحداً */}
                        <span className="tiny muted">ليش رشّحناه: {why.join(" · ")}</span>
                      </span>
                      <span className={priceFils === null ? "price-na" : "price"}>{priceFils === null ? UNAVAILABLE_LABEL : formatFils(priceFils)}</span>
                    </div>
                    <button className="btn" style={{ marginTop: 12 }} disabled={priceFils === null}
                      onClick={() => {
                        if (priceFils === null) return;
                        cart.add({ id: `ready:${p.handle}`, kind: "ready", title: p.title, unitPriceFils: priceFils });
                        navigate("/cart");
                      }}>
                      {priceFils === null ? UNAVAILABLE_LABEL : "أضف للسلة"}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        }
      </Async>
      <button className="btn ghost" style={{ marginTop: 18 }} onClick={() => { setStep(0); setAnswers({}); }}>ابدأ من جديد</button>
    </>
  );
}
