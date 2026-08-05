/**
 * Wireframe only. It exercises the mock payment adapter so the journey has an
 * end; it does not implement checkout. Real fields, real validation and a real
 * provider are later work, deliberately not started.
 */
import { useState } from "react";
import { useCart } from "@/lib/cart";
import { mockPaymentAdapter, outbox } from "@/adapters/mock";

export default function Checkout() {
  const cart = useCart();
  const [result, setResult] = useState<string | null>(null);

  return (
    <>
      <h1>إتمام الطلب</h1>
      <p className="placeholder-price" style={{ display: "inline-block" }}>واجهة تجريبية — لا دفع حقيقي</p>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted small">عدد الأصناف</span><span>{cart.count}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>المجموع</strong><strong>{cart.subtotal} د.إ</strong>
        </div>
      </div>

      <button className="btn" style={{ marginTop: 14 }} disabled={cart.count === 0}
        onClick={async () => {
          const res = await mockPaymentAdapter.createIntent({ orderNumber: `STG-${Date.now()}`, amountFils: cart.subtotal * 100 });
          setResult(res.inert ? `لم يُنفَّذ أي دفع. سُجِّل في outbox (${outbox.length} عملية).` : "غير متوقع");
        }}>
        ادفع (تجريبي)
      </button>

      {result && <p className="small" style={{ marginTop: 12 }} role="status">{result}</p>}
    </>
  );
}
