/** تفاصيل عطر جاهز — نهاية الرحلة الأولى: يعرف الاسم، يبحث، يضيف للسلة. */
import { Link, useNavigate, useParams } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { useCart } from "@/lib/cart";
import { formatFils, readyMadePriceFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";

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
          action={<Link className="btn ghost" to="/ready" style={{ display: "inline-block", maxWidth: 240, marginTop: 12 }}>تصفّح المتوفر</Link>} />
      }
    >
      {(p) => {
        // السعر المخزَّن كما هو؛ لا سعر صالح ⇒ لا شراء ولا رقم بديل.
        const priceFils = readyMadePriceFils(p.priceFils);
        const buyable = p.is_available && priceFils !== null;
        return (
          <>
            <h1>{p.title}</h1>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted small">السعر</span>
                <strong style={{ fontSize: 20 }} data-testid="product-price">{priceFils === null ? UNAVAILABLE_LABEL : formatFils(priceFils)}</strong>
              </div>
              <p className="tiny muted" style={{ marginBottom: 0 }}>
                {priceFils === null ? UNAVAILABLE_LABEL : p.is_available ? `متوفر — ${p.quantity} قطعة` : UNAVAILABLE_LABEL}
              </p>
            </div>

            {/* الشحن يُعرض هنا لا في آخر خطوة — المفاجأة السعرية سبب معروف لهجر السلة */}
            <p className="tiny muted" style={{ marginTop: 10 }}>الشحن يُحتسب في السلة · التوصيل داخل الإمارات</p>

            <button
              className="btn" style={{ marginTop: 14 }} disabled={!buyable} data-testid="add-to-cart"
              onClick={() => {
                if (priceFils === null) return;
                cart.add({ id: `ready:${p.handle}`, kind: "ready", title: p.title, unitPriceFils: priceFils });
                navigate("/cart");
              }}
            >
              {buyable ? "أضف للسلة" : UNAVAILABLE_LABEL}
            </button>
          </>
        );
      }}
    </Async>
  );
}
