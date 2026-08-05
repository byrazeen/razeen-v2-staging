/**
 * Home is an access system, not a landing page.
 *
 * Five doors, above the fold, on a phone. The audit found the live hero pushing
 * one journey and burying the rest, and a customer needing seven screens to buy.
 */
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";

const DOORS = [
  { to: "/search",  title: "أعرف اسم العطر", hint: "ابحث باسم العطر أو البراند" },
  { to: "/ready",   title: "العطور الجاهزة", hint: "تصفّح المتوفر الآن" },
  { to: "/custom",  title: "صمّم عطرك الخاص", hint: "اختر العطر والحجم" },
  { to: "/discover",title: "ما أدري وش أبي", hint: "أسئلة قصيرة ونرشّح لك" },
  { to: "/cart",    title: "سلتي", hint: "أكمل طلبك" },
];

/** أبواب staging فقط — تختفي يوم يصير هذا متجراً حقيقياً. */
const STAGING_DOORS = [
  { to: "/admin",  title: "لوحة الإدارة (تجريبي)", hint: "الطلبات وقائمة التصنيع" },
  { to: "/outbox", title: "صندوق الصادر (تجريبي)", hint: "الرسائل التي لم تُرسَل" },
];

export default function Home() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  return (
    <>
      <h1>وش تبي اليوم؟</h1>
      <form
        onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q)}`); }}
        style={{ marginBottom: 16 }}
      >
        <label htmlFor="home-search" className="small muted">ابحث باسم العطر</label>
        <input
          id="home-search" className="field" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="مثال: عود · مسك · عنبر"
          style={{ marginTop: 6 }}
        />
      </form>

      <div className="grid two">
        {DOORS.map((d) => (
          <Link key={d.to} to={d.to} className="tile">
            <strong>{d.title}</strong>
            <span className="muted tiny">{d.hint}</span>
          </Link>
        ))}
      </div>

      <h2>أدوات البيئة التجريبية</h2>
      <div className="grid two">
        {STAGING_DOORS.map((d) => (
          <Link key={d.to} to={d.to} className="tile">
            <strong>{d.title}</strong>
            <span className="muted tiny">{d.hint}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
