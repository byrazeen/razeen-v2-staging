/**
 * الحساب في staging: لا تسجيل دخول للعملاء بعد، لكن الطلبات المُنشأة في هذه
 * البيئة تُعرض هنا كي يتتبّعها من يجرّب الرحلة.
 */
import { Link } from "react-router-dom";
import { repository, type Order } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { STAGING_PRICING_PLACEHOLDER } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";

export default function Account() {
  const state = useAsync(() => repository.listOrders(), []);

  return (
    <>
      <h1>طلباتي</h1>
      <p className="tiny muted">تسجيل دخول العملاء لم يُبنَ بعد — تُعرض هنا كل طلبات هذه البيئة التجريبية.</p>
      <Async
        state={state}
        isEmpty={(orders: Order[]) => orders.length === 0}
        empty={<Empty title="ما عندك طلبات" hint="ابدأ من البحث أو العطور الجاهزة."
          action={<Link className="btn" to="/" style={{ display: "inline-block", maxWidth: 240, marginTop: 12 }}>ابدأ التسوّق</Link>} />}
      >
        {(orders) => (
          <div className="grid" style={{ marginTop: 12 }}>
            {orders.map((o) => (
              <div key={o.orderNumber} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{o.orderNumber}</strong>
                  <span style={{ fontWeight: 700 }}>{STAGING_PRICING_PLACEHOLDER.format(o.total)}</span>
                </div>
                <span className="tiny muted" style={{ display: "block" }}>
                  الدفع: {o.paymentStatus} · التصنيع: {o.productionStatus} · الشحن: {o.shippingStatus}
                </span>
              </div>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}
