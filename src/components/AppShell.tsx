/**
 * The shell every screen sits in: brand, search, cart, account — all reachable
 * from anywhere, in one tap. The production store put its catalogue behind a
 * language gate and its search behind a page; both are gone here by design.
 *
 * الهوية تعيش هنا: إطار حبريّ (ترويسة وذيل) حول عمود ورقيّ يُقرأ بلا جهد.
 * الأيقونات مرسومة يدوياً بـSVG — لا حزمة أيقونات ولا محرف رموز.
 */
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useCart } from "@/lib/cart";
import { StagingBanner } from "./StagingBanner";

const stroke = {
  fill: "none", stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" />
    </svg>
  );
}
function IconBag() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M5.5 8h13l-1 12h-11z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1-3.7 3.7-5.5 7-5.5s6 1.8 7 5.5" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { count } = useCart();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /** شاشات التشغيل ترث نفس الهوية بصوت أخفض: بلا بطل، وكثافة أعلى. */
  const utilitarian = pathname.startsWith("/admin") || pathname === "/outbox";

  return (
    <>
      <StagingBanner />
      <header className="hdr">
        <div className="hdr-in">
          <Link to="/" className="brand" aria-label="رزين — الرئيسية">
            <b>رزين</b><span className="lat" aria-hidden="true">RAZEEN</span>
          </Link>
          <button className="icon-btn" aria-label="البحث عن عطر" onClick={() => navigate("/search")}>
            <IconSearch />
          </button>
          <button className="icon-btn" aria-label={`السلة — ${count} صنف`} onClick={() => navigate("/cart")}>
            <IconBag />{count > 0 && <span className="badge">{count}</span>}
          </button>
          <button className="icon-btn" aria-label="حسابي" onClick={() => navigate("/account")}>
            <IconUser />
          </button>
        </div>
      </header>
      {/* المفتاح يعيد تشغيل حركة الدخول عند كل انتقال — 340ms، وتُطفأ عند prefers-reduced-motion */}
      <main className={`wrap ${utilitarian ? "admin" : ""}`.trim()} key={pathname}>{children}</main>
      <footer className="foot">
        <span className="lat">RAZEEN V2</span> · نسخة تجريبية للتصميم والاختبار
      </footer>
    </>
  );
}
