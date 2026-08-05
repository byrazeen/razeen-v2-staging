/** تفاصيل عطر جاهز — نهاية الرحلة الأولى: يعرف الاسم، يبحث، يضيف للسلة. */
import { Link, useNavigate, useParams } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { useCart } from "@/lib/cart";
import { STAGING_PRICING_PLACEHOLDER } from "@/lib/pricing";
import { Async, Empty, PlaceholderPriceNote } from "@/components/states";

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
        const quote = STAGING_PRICING_PLACEHOLDER.quoteReadyMade(p.price);
        return (
          <>
            <h1>{p.title}</h1>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted small">السعر</span>
                <strong style={{ fontSize: 20 }}>{STAGING_PRICING_PLACEHOLDER.format(quote.unitPrice)}</strong>
              </div>
              <p className="tiny muted" style={{ marginBottom: 0 }}>
                {p.is_available ? `متوفر — ${p.quantity} قطعة` : "غير متوفر حالياً"}
              </p>
              <PlaceholderPriceNote />
            </div>

            {/* الشحن يُعرض هنا لا في آخر خطوة — المفاجأة السعرية سبب معروف لهجر السلة */}
            <p className="tiny muted" style={{ marginTop: 10 }}>الشحن يُحتسب في السلة · التوصيل داخل الإمارات</p>

            <button
              className="btn" style={{ marginTop: 14 }} disabled={!p.is_available}
              onClick={() => {
                cart.add({ id: `ready:${p.handle}`, kind: "ready", title: p.title, unitPrice: quote.unitPrice });
                navigate("/cart");
              }}
            >
              {p.is_available ? "أضف للسلة" : "غير متوفر"}
            </button>
          </>
        );
      }}
    </Async>
  );
}
