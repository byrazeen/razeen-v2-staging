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

/** رسالة العميل حين تفشل قراءة الطلبات — عربية، بلا نصّ استثناء. */
const ORDERS_ERROR = "تعذّر تحميل الطلبات. تأكد من اتصالك وحاول مرة ثانية.";
import { formatFils } from "@/lib/pricing";
import { AdminGate } from "@/components/AdminGate";
import { Async, Empty } from "@/components/states";
import { Iso, OrderNumber } from "@/components/text";
import { productionLabel, shippingLabel } from "@/lib/statusLabels";

export default function ProductionQueue() {
  const state = useAsync(() => repository.listProductionQueue(), [], { errorMessage: ORDERS_ERROR });

  return (
    <AdminGate>
      <h1>قائمة التصنيع</h1>
      <p className="tiny muted">المدفوع فقط — الطلب غير المدفوع لا يدخل هنا مهما كانت حالته.</p>

      <Async
        state={state}
        isEmpty={(orders: Order[]) => orders.length === 0}
        empty={<Empty title="ما في طلبات مدفوعة" hint="لن يظهر أي طلب هنا قبل نجاح الدفع." headingLevel={2} />}
      >
        {(orders) => (
          <div className="grid list-2" style={{ marginTop: 12 }} data-testid="queue-list">
            {/* حزام أمان: حتى لو تغيّر التنفيذ يوماً، غير المدفوع لا يُرسم. */}
            {orders.filter(isProductionEligible).map((o) => (
              <Link key={o.orderNumber} to={`/admin/orders/${o.orderNumber}`} className="card">
                <div className="row">
                  <strong><OrderNumber>{o.orderNumber}</OrderNumber></strong>
                  <span className="price" style={{ marginInlineStart: "auto" }}>{formatFils(o.totalFils)}</span>
                </div>
                <span className="tiny muted" style={{ display: "block" }}>{o.customer.name} · {o.customer.address.emirate}</span>
                <div className="chips" style={{ margin: "10px 0" }}>
                  <span className="tag flat">التصنيع: {productionLabel(o.productionStatus)}</span>
                  <span className="tag flat">الشحن: {shippingLabel(o.shippingStatus)}</span>
                </div>
                {o.lines.map((l) => (
                  <span key={l.id} className="tiny muted" style={{ display: "block" }}>
                    {/* كل مقطع لاتيني معزول: السطر المختلط كان يُظهر الفاصل ملاصقاً للمقطع الخطأ. */}
                    • <Iso>{l.title}</Iso> ×<Iso className="num">{l.quantity}</Iso>
                    {l.perfumeCode ? <> · <Iso className="num">{l.perfumeCode}</Iso></> : null}
                    {l.size ? <> · <Iso className="num">{l.size}</Iso></> : null}
                  </span>
                ))}
              </Link>
            ))}
          </div>
        )}
      </Async>

      <Link className="chip" to="/admin" style={{ display: "inline-flex", alignItems: "center", marginTop: 18 }}>رجوع للطلبات</Link>
    </AdminGate>
  );
}
