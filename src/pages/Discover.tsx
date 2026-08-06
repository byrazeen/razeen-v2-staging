/**
 * Journey C — the undecided customer.
 *
 * Three questions, skippable at every step, ending in a handful of picks that
 * each say WHY they were picked. Only available stock is ever recommended:
 * recommending something that cannot be bought is worse than recommending
 * nothing.
 *
 * الإجابات تعيش في رابط الصفحة لا في حالة المكوّن. الرجوع بزرّ المتصفّح كان
 * يمسح الاستبيان كله ويعيدك إلى «سؤال 1 من 3»: من أراد مقارنة الترشيحات
 * الأخرى كان عليه إعادة الاستبيان من أوّله. ومع الرابط صارت النتيجة قابلة
 * للمشاركة كما هي، وصار «السؤال السابق» ممكناً بلا حالة إضافية.
 */
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { useCart } from "@/lib/cart";
import { readyMadePriceFils, UNAVAILABLE_LABEL, FILS_PER_AED } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";
import { ProductCard } from "@/components/ProductCard";

/**
 * علامة الخيار.
 *
 * كانت الأسئلة أربعة مستطيلات رمادية متطابقة — أكثر شاشة قالبيّة في البناء،
 * وسؤالٌ عن الرائحة بلا أي إشارة إلى ما تعنيه الإجابة. العلامة هنا لا تخترع
 * صورةً: العائلة مسحةٌ من ألوان الدار نفسها (ذهب للدافئ، ورق للمنعش، بنفسجي
 * للحلو، حبر للخشبي)، والقوة ثلاثة أعمدة يضيء منها بقدرها. زخرفة صرفة: النصّ
 * وحده يحمل المعنى للقارئ الصوتي.
 */
function OptionMark({ family, level }: { family?: string; level?: number }) {
  if (family) {
    return <span className="mark" aria-hidden="true"><span className={`swatch ${family}`} /></span>;
  }
  if (level) {
    return (
      <span className="mark" aria-hidden="true">
        <span className="bars">
          {[1, 2, 3].map((i) => <i key={i} className={i <= level ? "on" : ""} />)}
        </span>
      </span>
    );
  }
  return null;
}

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

/** الخطوة كما هي في الرابط، محصورة في المدى الصالح. */
function readStep(params: URLSearchParams): number {
  const raw = Number(params.get("q"));
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(Math.trunc(raw), 0), QUESTIONS.length);
}

export default function Discover() {
  const [params, setParams] = useSearchParams();
  const step = readStep(params);
  const answers = useMemo(() => {
    const found: Record<string, string> = {};
    for (const q of QUESTIONS) {
      const value = params.get(q.key);
      if (value) found[q.key] = value;
    }
    return found;
  }, [params]);
  const done = step >= QUESTIONS.length;

  /** كل انتقال دفعةٌ في تاريخ المتصفّح — وهذا بالضبط ما يجعل «رجوع» يعمل. */
  const goto = (nextStep: number, patch: Record<string, string | null> = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key); else next.set(key, value);
    }
    if (nextStep === 0 && Object.keys(patch).length === 0) {
      for (const q of QUESTIONS) next.delete(q.key);
    }
    next.set("q", String(nextStep));
    setParams(next);
  };
  const state = useAsync(() => repository.listProducts(), [], { cacheKey: "products" });
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
            <button key={o.value} className={`btn ghost ${q.key === "budget" ? "" : "opt"}`.trim()}
              onClick={() => goto(step + 1, { [q.key]: o.value })}>
              <OptionMark
                family={q.key === "family" ? o.value : undefined}
                level={q.key === "intensity" ? Number(o.value) : undefined}
              />
              {o.label}
            </button>
          ))}
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => goto(step + 1, { [q.key]: null })}>تخطَّ هذا السؤال</button>
          {/* «السؤال السابق» لم يكن موجوداً أصلاً: خطأ في الإجابة كان يعني إعادة الاستبيان. */}
          <button className="btn ghost" disabled={step === 0}
            onClick={() => goto(step - 1, { [QUESTIONS[Math.max(step - 1, 0)].key]: null })}>السؤال السابق</button>
        </div>
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
            <div className="shelf">
              {picks.map(({ p, why }) => {
                const priceFils = readyMadePriceFils(p.priceFils);
                return (
                  <div key={p.handle} className="pick">
                    <ProductCard
                      handle={p.handle} title={p.title} priceFils={priceFils}
                      family={p.family} intensity={p.intensity}
                      state={`متوفر — ${p.quantity} قطعة`}
                    />
                    {/* السبب معروض دائماً — الترشيح بلا تعليل لا يُقنع أحداً */}
                    <p className="why">ليش رشّحناه: {why.join(" · ")}</p>
                    <button className="btn" disabled={priceFils === null}
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
      <div className="grid two" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={() => goto(QUESTIONS.length - 1, { [QUESTIONS[QUESTIONS.length - 1].key]: null })}>عدّل آخر إجابة</button>
        <button className="btn ghost" onClick={() => goto(0)}>ابدأ من جديد</button>
      </div>
    </>
  );
}
