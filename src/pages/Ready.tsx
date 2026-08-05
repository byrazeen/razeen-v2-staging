/** Ready-made shelf. Sold-out items are shown last and never look buyable. */
import { Link } from "react-router-dom";
import { products } from "@/data/mock";

export default function Ready() {
  const sorted = [...products].sort((a, b) => Number(b.is_available) - Number(a.is_available));
  return (
    <>
      <h1>العطور الجاهزة</h1>
      <p className="tiny muted">{products.filter((p) => p.is_available).length} متوفر من {products.length}</p>
      <div className="grid" style={{ marginTop: 12 }}>
        {sorted.map((p) => (
          <Link key={p.handle} to={`/product/${p.handle}`} className="card row" style={{ justifyContent: "space-between", opacity: p.is_available ? 1 : 0.55 }}>
            <span>
              <strong>{p.title}</strong>
              <span className="tiny muted" style={{ display: "block" }}>{p.is_available ? "متوفر" : "نفد — لا يُعرض للشراء"}</span>
            </span>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{p.price} د.إ</span>
          </Link>
        ))}
      </div>
    </>
  );
}
