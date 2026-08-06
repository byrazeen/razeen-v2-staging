/**
 * الحساب في staging: لا تسجيل دخول للعملاء بعد، لكن الطلبات المُنشأة في هذه
 * البيئة تُعرض هنا كي يتتبّعها من يجرّب الرحلة.
 */
import { Link } from "react-router-dom";
import { repository, type Order } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { formatFils } from "@/lib/pricing";
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
          action={<Link className="btn" to="/" style={{ maxWidth: 240, margin: "14px auto 0" }}>ابدأ التسوّق</Link>} />}
      >
        {(orders) => (
          <div className="grid list-2" style={{ marginTop: 12 }}>
            {orders.map((o) => (
              <div key={o.orderNumber} className="card">
                <div className="row">
                  <strong className="num">{o.orderNumber}</strong>
                  <span className="price" style={{ marginInlineStart: "auto" }}>{formatFils(o.totalFils)}</span>
                </div>
                <div className="chips" style={{ marginTop: 10 }}>
                  <span className="tag flat">الدفع: {o.paymentStatus}</span>
                  <span className="tag flat">التصنيع: {o.productionStatus}</span>
                  <span className="tag flat">الشحن: {o.shippingStatus}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}
