/**
 * قائمة التصنيع — **الطلبات المدفوعة فقط، بلا استثناء**.
 *
 * القاعدة تُطبَّق في طبقة البيانات (`listProductionQueue` + `isProductionEligible`)
 * لا هنا، كي لا يستطيع أي عرض جديد أن يخرقها. هذه الصفحة تعرض ما تُعطيه، وتؤكد
 * القاعدة للقارئ. طلب غير مدفوع أو فشل دفعه لا يصل المشغل أبداً.
 */
import { Link } from "react-router-dom";
import { repository, isProductionEligible, type Order } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { formatFils } from "@/lib/pricing";
import { AdminGate } from "@/components/AdminGate";
import { Async, Empty } from "@/components/states";

export default function ProductionQueue() {
  const state = useAsync(() => repository.listProductionQueue(), []);

  return (
    <AdminGate>
      <h1>قائمة التصنيع</h1>
      <p className="tiny muted">المدفوع فقط — الطلب غير المدفوع لا يدخل هنا مهما كانت حالته.</p>

      <Async
        state={state}
        isEmpty={(orders: Order[]) => orders.length === 0}
        empty={<Empty title="ما في طلبات مدفوعة" hint="لن يظهر أي طلب هنا قبل نجاح الدفع." />}
      >
        {(orders) => (
          <div className="grid" style={{ marginTop: 12 }} data-testid="queue-list">
            {/* حزام أمان: حتى لو تغيّر التنفيذ يوماً، غير المدفوع لا يُرسم. */}
            {orders.filter(isProductionEligible).map((o) => (
              <Link key={o.orderNumber} to={`/admin/orders/${o.orderNumber}`} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{o.orderNumber}</strong>
                  <span style={{ fontWeight: 700 }}>{formatFils(o.totalFils)}</span>
                </div>
                <span className="tiny muted" style={{ display: "block" }}>{o.customer.name} · {o.customer.address.emirate}</span>
                <span className="tiny" style={{ display: "block", marginTop: 4 }}>التصنيع: {o.productionStatus} · الشحن: {o.shippingStatus}</span>
                {o.lines.map((l) => (
                  <span key={l.id} className="tiny muted" style={{ display: "block" }}>
                    • {l.title} ×{l.quantity}{l.perfumeCode ? ` · ${l.perfumeCode}` : ""}{l.size ? ` · ${l.size}` : ""}
                  </span>
                ))}
              </Link>
            ))}
          </div>
        )}
      </Async>

      <Link className="btn ghost" to="/admin" style={{ display: "inline-block", marginTop: 14 }}>رجوع للطلبات</Link>
    </AdminGate>
  );
}
