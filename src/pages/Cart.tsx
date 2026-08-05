/**
 * One cart, both kinds of line. Shipping is stated here rather than sprung at
 * the last step, and a placeholder price is labelled as one so nobody mistakes
 * the prototype's number for a quote.
 */
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "@/lib/cart";
import { STAGING_PRICING_PLACEHOLDER } from "@/lib/pricing";
import { Empty, PlaceholderPriceNote } from "@/components/states";

export default function Cart() {
  const cart = useCart();
  const navigate = useNavigate();
  if (cart.lines.length === 0) {
    return <Empty title="سلتك فاضية" hint="ابدأ من البحث أو العطور الجاهزة."
      action={<Link className="btn" to="/" style={{ display: "inline-block", maxWidth: 240, marginTop: 12 }}>ابدأ التسوّق</Link>} />;
  }
  const totals = cart.totals;
  const hasPlaceholder = cart.lines.some((l) => l.isPlaceholderPrice);
  const money = STAGING_PRICING_PLACEHOLDER.format;

  return (
    <>
      <h1>سلتي</h1>
      <div className="grid">
        {cart.lines.map((l) => (
          <div key={l.id} className="card" data-testid="cart-line">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>{l.title}</strong>
                {l.subtitle && <span className="tiny muted" style={{ display: "block" }}>{l.subtitle}</span>}
                <span className="tiny muted">{l.kind === "custom" ? "عطر مخصص" : "عطر جاهز"}</span>
              </span>
              <strong style={{ whiteSpace: "nowrap" }}>{money(STAGING_PRICING_PLACEHOLDER.lineTotal(l))}</strong>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="icon-btn" aria-label={`أنقص ${l.title}`} onClick={() => cart.setQuantity(l.id, l.quantity - 1)}>−</button>
              <span style={{ minWidth: 28, textAlign: "center" }}>{l.quantity}</span>
              <button className="icon-btn" aria-label={`زد ${l.title}`} onClick={() => cart.setQuantity(l.id, l.quantity + 1)}>+</button>
              <button className="icon-btn" aria-label={`احذف ${l.title}`} style={{ marginInlineStart: "auto" }} onClick={() => cart.remove(l.id)}>حذف</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}><span className="muted small">المجموع</span><span>{money(totals.subtotal)}</span></div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted small">الشحن</span>
          <span>{totals.shipping === 0 ? "مجاني" : money(totals.shipping)}</span>
        </div>
        {totals.shipping > 0 && (
          <p className="tiny muted" style={{ margin: "4px 0 0" }}>
            أضف {STAGING_PRICING_PLACEHOLDER.freeShippingFromItems - totals.itemCount} عطر ويصير الشحن مجاني.
          </p>
        )}
        <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <strong>الإجمالي</strong><strong style={{ fontSize: 20 }} data-testid="cart-total">{money(totals.total)}</strong>
        </div>
        {hasPlaceholder && <PlaceholderPriceNote />}
      </div>

      <button className="btn" style={{ marginTop: 14 }} onClick={() => navigate("/checkout")}>أكمل الطلب</button>
    </>
  );
}
