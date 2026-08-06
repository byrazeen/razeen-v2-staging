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

const PAYMENT_LABEL: Record<string, string> = {
  paid: "مدفوع", unpaid: "غير مدفوع", failed: "فشل الدفع", refunded: "مسترجع",
};

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
        empty={<Empty title="لا توجد طلبات" hint="أنشئ طلباً من إتمام الطلب." />}
      >
        {(orders) => (
          <>
            <button className="chip" style={{ marginBottom: 14 }} data-testid="export-csv"
              onClick={() => downloadCsv(`razeen-staging-orders-${new Date().toISOString().slice(0, 10)}.csv`, ordersToCsv(orders))}>
              تصدير CSV ({orders.length} طلب)
            </button>
            <div className="grid list-2">
              {orders.map((o) => (
                <Link key={o.orderNumber} to={`/admin/orders/${o.orderNumber}`} className="card">
                  <div className="row">
                    <strong className="num">{o.orderNumber}</strong>
                    <span className="price" style={{ marginInlineStart: "auto" }}>{formatFils(o.totalFils)}</span>
                  </div>
                  <span className="tiny muted" style={{ display: "block" }}>
                    {o.customer.name} · <span className="num">{o.customer.phone}</span> · {o.customer.address.emirate}
                  </span>
                  <div className="chips" style={{ marginTop: 10 }}>
                    <span className={`tag ${o.paymentStatus === "paid" ? "ok" : "warn"}`}>
                      {PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}
                    </span>
                    <span className="tag flat">التصنيع: {o.productionStatus}</span>
                    <span className="tag flat">الشحن: {o.shippingStatus}</span>
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
