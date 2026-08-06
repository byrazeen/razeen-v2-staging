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

  return (
    <>
      <section className="hero">
        <p className="eyebrow">دار عطور · الإمارات</p>
        <h1>عطرك، كما تعرفه أو كما تتخيّله</h1>
        <p>جاهز من الرف، أو مركَّب لك بالحجم الذي تختاره. التوصيل داخل الإمارات.</p>
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

      <p className="eyebrow">وش تبي اليوم؟</p>
      <div className="grid doors">
        {DOORS.map((d) => (
          <Link key={d.to} to={d.to} className={`tile ${d.lead ? "lead" : ""}`.trim()}>
            <strong>{d.title}</strong>
            <span className="tiny">{d.hint}</span>
          </Link>
        ))}
      </div>

      <p className="eyebrow">أدوات البيئة التجريبية</p>
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
