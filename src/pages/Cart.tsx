/**
 * One cart, both kinds of line. Shipping is stated here rather than sprung at
 * the last step, and a placeholder price is labelled as one so nobody mistakes
 * the prototype's number for a quote.
 */
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "@/lib/cart";
import { formatFils, lineTotalFils, BULK_THRESHOLD_ITEMS, BULK_DISCOUNT_PERCENT } from "@/lib/pricing";
import { Empty } from "@/components/states";
import { arabicCount, PERFUME_FORMS } from "@/lib/arabic";
import { Media } from "@/components/Media";

export default function Cart() {
  const cart = useCart();
  const navigate = useNavigate();
  if (cart.lines.length === 0) {
    return <Empty title="سلتك فاضية" hint="ابدأ من البحث أو العطور الجاهزة." headingLevel={1}
      action={<Link className="btn" to="/" style={{ maxWidth: 240, margin: "14px auto 0" }}>ابدأ التسوّق</Link>} />;
  }
  const totals = cart.totals;
  const money = formatFils;

  return (
    <>
      <h1>سلتي</h1>
      <p className="lede">الشحن ظاهر هنا، لا في آخر خطوة.</p>
      <div className="grid">
        {cart.lines.map((l) => (
          <div key={l.id} className="card" data-testid="cart-line">
            <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
              <Media size="thumb" label={l.title} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ display: "block", lineHeight: 1.5 }}>{l.title}</strong>
                {l.subtitle && <span className="tiny muted" style={{ display: "block" }}>{l.subtitle}</span>}
                <span className="tag flat">{l.kind === "custom" ? "عطر مخصص" : "عطر جاهز"}</span>
              </span>
              <strong className="price">{money(lineTotalFils(l))}</strong>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="icon-btn" aria-label={`أنقص ${l.title}`} onClick={() => cart.setQuantity(l.id, l.quantity - 1)}>−</button>
              <span style={{ minWidth: 28, textAlign: "center" }}>{l.quantity}</span>
              <button className="icon-btn" aria-label={`زد ${l.title}`} onClick={() => cart.setQuantity(l.id, l.quantity + 1)}>+</button>
              <button className="icon-btn" aria-label={`احذف ${l.title}`} style={{ marginInlineStart: "auto" }} onClick={() => cart.remove(l.id)}>حذف</button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="eyebrow">الحساب</h2>
      <div className="panel">
        <div className="sum">
          <span>المجموع</span><span className="price" data-testid="cart-subtotal">{money(totals.subtotalFils)}</span>
        </div>
        {totals.discountFils > 0 && (
          <div className="sum">
            <span>خصم الكمية ({BULK_DISCOUNT_PERCENT}%)</span>
            <span className="price" data-testid="cart-discount">−{money(totals.discountFils)}</span>
          </div>
        )}
        <div className="sum">
          <span>الشحن</span>
          <span className="price" data-testid="cart-shipping">{totals.shippingFils === 0 ? "مجاني" : money(totals.shippingFils)}</span>
        </div>
        <div className="sum total">
          <span>الإجمالي</span><strong className="price price-lg" data-testid="cart-total">{money(totals.totalFils)}</strong>
        </div>
        {!totals.bulkApplied && totals.itemCount > 0 && (
          <p className="tiny muted" style={{ margin: "10px 0 0" }}>
            {/* «أضف 2 عطر» خطأ نحوي — المطابقة من مساعد واحد بدل حالة مكتوبة بخط اليد. */}
            أضف {arabicCount(BULK_THRESHOLD_ITEMS - totals.itemCount, PERFUME_FORMS)} ويصير الشحن مجاني مع خصم {BULK_DISCOUNT_PERCENT}%.
          </p>
        )}
      </div>

      <div className="actionbar">
        <button className="btn" onClick={() => navigate("/checkout")}>أكمل الطلب</button>
      </div>
    </>
  );
}
