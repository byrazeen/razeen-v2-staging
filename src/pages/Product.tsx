/**
 * تفاصيل عطر جاهز — نهاية الرحلة الأولى: يعرف الاسم، يبحث، يضيف للسلة.
 *
 * الصورة أولاً وأكبر عنصر في الصفحة، ثم الاسم والسعر، ثم زر الشراء في متناول
 * الإبهام. الشحن مذكور هنا لا في آخر خطوة.
 */
import { Link, useNavigate, useParams } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { useCart } from "@/lib/cart";
import { formatFils, readyMadePriceFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";
import { Media } from "@/components/Media";

export default function Product() {
  const { handle } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const state = useAsync(() => repository.getProduct(handle ?? ""), [handle]);

  return (
    <Async
      state={state}
      empty={
        <Empty title="ما لقينا هذا المنتج"
          action={<Link className="btn ghost" to="/ready" style={{ maxWidth: 240, margin: "14px auto 0" }}>تصفّح المتوفر</Link>} />
      }
    >
      {(p) => {
        // السعر المخزَّن كما هو؛ لا سعر صالح ⇒ لا شراء ولا رقم بديل.
        const priceFils = readyMadePriceFils(p.priceFils);
        const buyable = p.is_available && priceFils !== null;
        return (
          <div className="product">
            <div className="product-media">
              <Media label={p.title} />
              <p className="media-cap">صورة العطر تُضاف قبل الإطلاق</p>
            </div>

            <div className="product-info">
              <h1>{p.title}</h1>

              <div className="sum" style={{ borderTop: "1px solid var(--gold)", paddingTop: 14, marginTop: 8 }}>
                <span>السعر</span>
                {priceFils === null
                  ? <strong className="price-na" data-testid="product-price">{UNAVAILABLE_LABEL}</strong>
                  : <strong className="price price-lg" data-testid="product-price">{formatFils(priceFils)}</strong>}
              </div>

              <p style={{ margin: "10px 0 0" }}>
                {priceFils === null || !p.is_available
                  ? <span className="tag warn">{UNAVAILABLE_LABEL}</span>
                  : <span className="tag ok">متوفر — {p.quantity} قطعة</span>}
              </p>

              {/* الشحن يُعرض هنا لا في آخر خطوة — المفاجأة السعرية سبب معروف لهجر السلة */}
              <p className="tiny muted" style={{ marginTop: 12 }}>
                الشحن يُحتسب في السلة · التوصيل داخل الإمارات
              </p>

              <div className="actionbar">
                <button
                  className="btn" disabled={!buyable} data-testid="add-to-cart"
                  onClick={() => {
                    if (priceFils === null) return;
                    cart.add({ id: `ready:${p.handle}`, kind: "ready", title: p.title, unitPriceFils: priceFils });
                    navigate("/cart");
                  }}
                >
                  {buyable ? "أضف للسلة" : UNAVAILABLE_LABEL}
                </button>
              </div>
            </div>
          </div>
        );
      }}
    </Async>
  );
}
