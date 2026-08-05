/**
 * The shell every screen sits in: brand, search, cart, account — all reachable
 * from anywhere, in one tap. The production store put its catalogue behind a
 * language gate and its search behind a page; both are gone here by design.
 */
import { Link, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useCart } from "@/lib/cart";
import { StagingBanner } from "./StagingBanner";

export function AppShell({ children }: { children: ReactNode }) {
  const { count } = useCart();
  const navigate = useNavigate();

  return (
    <>
      <StagingBanner />
      <header className="hdr">
        <div className="hdr-in">
          <Link to="/" className="brand" aria-label="رزين — الرئيسية">رزين</Link>
          <button className="icon-btn" aria-label="البحث عن عطر" onClick={() => navigate("/search")}>🔍</button>
          <button className="icon-btn" aria-label={`السلة — ${count} صنف`} onClick={() => navigate("/cart")}>
            🛍 {count > 0 && <span className="badge">{count}</span>}
          </button>
          <button className="icon-btn" aria-label="حسابي" onClick={() => navigate("/account")}>👤</button>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
