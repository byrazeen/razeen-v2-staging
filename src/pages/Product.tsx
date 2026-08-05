import { Link, useNavigate, useParams } from "react-router-dom";
import { products } from "@/data/mock";
import { useCart } from "@/lib/cart";
import { Empty } from "@/components/states";

export default function Product() {
  const { handle } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const p = products.find((x) => x.handle === handle);

  if (!p) return <Empty title="ما لقينا هذا المنتج" action={<Link className="btn ghost" to="/ready" style={{ display: "inline-block", maxWidth: 240, marginTop: 12 }}>تصفّح المتوفر</Link>} />;

  return (
    <>
      <h1>{p.title}</h1>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted small">السعر</span>
          <strong style={{ fontSize: 20 }}>{p.price} د.إ</strong>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          {p.is_available ? `متوفر — ${p.quantity} قطعة` : "غير متوفر حالياً"}
        </p>
      </div>

      {/* الشحن يُعرض هنا لا في آخر خطوة — المفاجأة السعرية سبب معروف لهجر السلة */}
      <p className="tiny muted" style={{ marginTop: 10 }}>الشحن يُحتسب في السلة · التوصيل داخل الإمارات</p>

      <button
        className="btn" style={{ marginTop: 14 }} disabled={!p.is_available}
        onClick={() => { cart.add({ id: `ready:${p.handle}`, kind: "ready", title: p.title, unitPrice: p.price }); navigate("/cart"); }}
      >
        {p.is_available ? "أضف للسلة" : "غير متوفر"}
      </button>
    </>
  );
}
