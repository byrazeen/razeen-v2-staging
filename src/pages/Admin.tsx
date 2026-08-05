/**
 * لوحة الإدارة (staging) — قائمة الطلبات، والتصدير، والمداخل لقائمة التصنيع
 * وصندوق الصادر. الحالات الثلاث للدفع والتصنيع والشحن معروضة صراحةً لأن
 * التدقيق وجد طلباً واحداً يحمل خمس مفردات متناقضة للحالة.
 */
import { Link } from "react-router-dom";
import { repository, type Order } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { STAGING_PRICING_PLACEHOLDER } from "@/lib/pricing";
import { downloadCsv, ordersToCsv } from "@/lib/csv";
import { AdminGate } from "@/components/AdminGate";
import { Async, Empty } from "@/components/states";

const PAYMENT_LABEL: Record<string, string> = {
  paid: "مدفوع", unpaid: "غير مدفوع", failed: "فشل الدفع", refunded: "مسترجع",
};

export default function Admin() {
  const state = useAsync(() => repository.listOrders(), []);

  return (
    <AdminGate>
      <h1>الطلبات</h1>
      <div className="grid two" style={{ marginBottom: 12 }}>
        <Link className="btn ghost" to="/admin/queue">قائمة التصنيع</Link>
        <Link className="btn ghost" to="/outbox">صندوق الصادر</Link>
      </div>

      <Async
        state={state}
        isEmpty={(orders: Order[]) => orders.length === 0}
        empty={<Empty title="لا توجد طلبات" hint="أنشئ طلباً من إتمام الطلب." />}
      >
        {(orders) => (
          <>
            <button className="btn ghost" style={{ marginBottom: 12 }} data-testid="export-csv"
              onClick={() => downloadCsv(`razeen-staging-orders-${new Date().toISOString().slice(0, 10)}.csv`, ordersToCsv(orders))}>
              تصدير CSV ({orders.length} طلب)
            </button>
            <div className="grid">
              {orders.map((o) => (
                <Link key={o.orderNumber} to={`/admin/orders/${o.orderNumber}`} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{o.orderNumber}</strong>
                    <span style={{ fontWeight: 700 }}>{STAGING_PRICING_PLACEHOLDER.format(o.total)}</span>
                  </div>
                  <span className="tiny muted" style={{ display: "block" }}>
                    {o.customer.name} · {o.customer.phone} · {o.customer.address.emirate}
                  </span>
                  <span className="tiny" style={{ display: "block", marginTop: 4 }}>
                    الدفع: {PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus} · التصنيع: {o.productionStatus} · الشحن: {o.shippingStatus}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </Async>
    </AdminGate>
  );
}
