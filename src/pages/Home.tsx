/**
 * Home is an access system, not a landing page.
 *
 * Five doors, above the fold, on a phone. The audit found the live hero pushing
 * one journey and burying the rest, and a customer needing seven screens to buy.
 * البطل هنا لا يبيع عطراً بعينه: يقول من نحن في سطر، ثم يفتح الأبواب فوراً.
 */
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Flacon } from "@/components/Media";
import { ProductCard } from "@/components/ProductCard";
import { Async } from "@/components/states";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { readyMadePriceFils } from "@/lib/pricing";

const DOORS = [
  { to: "/search",  title: "أعرف اسم العطر", hint: "ابحث باسم العطر أو البراند", lead: true },
  { to: "/ready",   title: "العطور الجاهزة", hint: "تصفّح المتوفر الآن" },
  { to: "/custom",  title: "صمّم عطرك الخاص", hint: "اختر العطر والحجم" },
  { to: "/discover",title: "ما أدري وش أبي", hint: "ثلاثة أسئلة ونرشّح لك" },
  { to: "/cart",    title: "سلتي", hint: "أكمل طلبك" },
];

/** أبواب staging فقط — تختفي يوم يصير هذا متجراً حقيقياً. */
const STAGING_DOORS = [
  { to: "/admin",  title: "لوحة الإدارة", hint: "تجريبي · الطلبات وقائمة التصنيع" },
  { to: "/outbox", title: "صندوق الصادر", hint: "تجريبي · الرسائل التي لم تُرسَل" },
];

export default function Home() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  /** نفس المفتاح المحفوظ الذي يقرأه الرفّ — لا طلب إضافي عند الانتقال إليه. */
  const shelf = useAsync(() => repository.listProducts(), [], { cacheKey: "products" });

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          {/* كلمة استهلال فوق العنوان — تبقى فقرة كي لا يسبق <h2> الـ<h1>. */}
          <p className="eyebrow">دار عطور · الإمارات</p>
          <h1>عطرك، كما تعرفه أو كما تتخيّله</h1>
          <p>جاهز من الرف، أو مركَّب لك بالحجم الذي تختاره. التوصيل داخل الإمارات.</p>
        </div>
        {/* القارورة في عمودها: كانت تمرّ خلف العنوان وتحت اللِّيد عند 1440 بكسل. */}
        <Flacon className="hero-flacon" />
        <span className="hero-thread" aria-hidden="true" />
      </section>

      <form onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q)}`); }}>
        <label htmlFor="home-search" className="small muted">ابحث باسم العطر</label>
        <input
          id="home-search" className="field" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="مثال: عود · مسك · عنبر"
          style={{ marginTop: 6 }}
        />
      </form>

      {/*
        الرئيسية كانت عنواناً وخمسة أبواب: لا عطر، ولا سعر، ولا توفر. زائر أول
        مرة لا يرى أن هنا شيئاً يُباع إلا بعد نقرة. ثلاثة من الرفّ، بأسعارها.
      */}
      <div className="row" style={{ marginTop: 26, marginBottom: 10 }}>
        <h2 className="eyebrow" style={{ margin: 0, flex: 1 }}>على الرف الآن</h2>
        <Link to="/ready" className="crumb">كل العطور</Link>
      </div>
      <Async state={shelf} isEmpty={(list) => list.length === 0} empty={<></>}>
        {(list) => (
          <div className="shelf strip">
            {list.filter((p) => p.is_available && readyMadePriceFils(p.priceFils) !== null)
              .slice(0, 3)
              .map((p) => (
                <ProductCard
                  key={p.handle} handle={p.handle} title={p.title}
                  priceFils={readyMadePriceFils(p.priceFils)}
                  family={p.family} intensity={p.intensity}
                  state={`متوفر — ${p.quantity} قطعة`}
                />
              ))}
          </div>
        )}
      </Async>

      <h2 className="eyebrow">وش تبي اليوم؟</h2>
      <div className="grid doors">
        {DOORS.map((d) => (
          <Link key={d.to} to={d.to} className={`tile ${d.lead ? "lead" : ""}`.trim()}>
            <strong>{d.title}</strong>
            <span className="tiny">{d.hint}</span>
          </Link>
        ))}
      </div>

      <h2 className="eyebrow">أدوات البيئة التجريبية</h2>
      <div className="grid two">
        {STAGING_DOORS.map((d) => (
          <Link key={d.to} to={d.to} className="tile">
            <strong>{d.title}</strong>
            <span className="tiny">{d.hint}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
