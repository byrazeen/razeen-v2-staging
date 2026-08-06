/**
 * لوحة الإدارة (staging) — قائمة الطلبات، والتصدير، والمداخل لقائمة التصنيع
 * وصندوق الصادر. الحالات الثلاث للدفع والتصنيع والشحن معروضة صراحةً لأن
 * التدقيق وجد طلباً واحداً يحمل خمس مفردات متناقضة للحالة.
 */
import { Link } from "react-router-dom";
import { repository, type Order } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { formatFils } from "@/lib/pricing";
import { downloadCsv, ordersToCsv } from "@/lib/csv";
import { AdminGate } from "@/components/AdminGate";
import { Async, Empty } from "@/components/states";
import { OrderNumber, Iso } from "@/components/text";
import { paymentLabel, productionLabel, shippingLabel } from "@/lib/statusLabels";
import { arabicCount, ORDER_FORMS } from "@/lib/arabic";

export default function Admin() {
  const state = useAsync(() => repository.listOrders(), []);

  return (
    <AdminGate>
      <h1>الطلبات</h1>
      <div className="chips" style={{ margin: "12px 0 18px" }}>
        <Link className="chip" to="/admin/queue">قائمة التصنيع</Link>
        <Link className="chip" to="/outbox">صندوق الصادر</Link>
      </div>

      <Async
        state={state}
        isEmpty={(orders: Order[]) => orders.length === 0}
        empty={<Empty title="لا توجد طلبات" hint="أنشئ طلباً من إتمام الطلب." headingLevel={2} />}
      >
        {(orders) => (
          <>
            <button className="chip" style={{ marginBottom: 14 }} data-testid="export-csv"
              onClick={() => downloadCsv(`razeen-staging-orders-${new Date().toISOString().slice(0, 10)}.csv`, ordersToCsv(orders))}>
              تصدير CSV ({arabicCount(orders.length, ORDER_FORMS)})
            </button>
            <div className="grid list-2">
              {orders.map((o) => (
                <Link key={o.orderNumber} to={`/admin/orders/${o.orderNumber}`} className="card">
                  <div className="row">
                    <strong><OrderNumber>{o.orderNumber}</OrderNumber></strong>
                    <span className="price" style={{ marginInlineStart: "auto" }}>{formatFils(o.totalFils)}</span>
                  </div>
                  <span className="tiny muted" style={{ display: "block" }}>
                    {o.customer.name} · <Iso className="num">{o.customer.phone}</Iso> · {o.customer.address.emirate}
                  </span>
                  <div className="chips" style={{ marginTop: 10 }}>
                    <span className={`tag ${o.paymentStatus === "paid" ? "ok" : "warn"}`}>
                      {paymentLabel(o.paymentStatus)}
                    </span>
                    {/* كانت تُعرض خاماً: «التصنيع: queued» داخل جملة عربية. */}
                    <span className="tag flat">التصنيع: {productionLabel(o.productionStatus)}</span>
                    <span className="tag flat">الشحن: {shippingLabel(o.shippingStatus)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Async>
    </AdminGate>
  );
}
