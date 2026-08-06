/**
 * طلب واحد في لوحة الإدارة: كل ما كتبه العميل ظاهر كما كتبه، وتحديث حالتي
 * التصنيع والشحن من هنا. تسليم الشحنة يسجّل إشعاراً في صندوق الصادر بدل إرساله.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { repository, isProductionEligible, type Order } from "@/data/repository";
import type { ProductionStatus, ShippingStatus } from "@/config/customOrderContract";
import { useAsync } from "@/lib/useAsync";
import { formatFils, lineTotalFils, BULK_DISCOUNT_PERCENT } from "@/lib/pricing";
import { notifyShipment } from "@/lib/orderFlow";
import { AdminGate } from "@/components/AdminGate";
import { Async, Empty } from "@/components/states";

const PRODUCTION: ProductionStatus[] = ["not_started", "queued", "oil_ready", "mixed", "bottled", "ready"];
const SHIPPING: ShippingStatus[] = ["not_shipped", "handed_over", "in_transit", "delivered", "returned"];

export default function AdminOrder() {
  const { orderNumber } = useParams();
  const state = useAsync(() => repository.getOrder(orderNumber ?? ""), [orderNumber]);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const current = order ?? state.data;

  return (
    <AdminGate>
      <Async state={state} empty={<Empty title="ما لقينا هذا الطلب" action={<Link className="btn ghost" to="/admin" style={{ display: "inline-block", maxWidth: 200, marginTop: 12 }}>رجوع</Link>} />}>
        {() => {
          if (!current) return null;
          return (
            <>
              <h1>{current.orderNumber}</h1>
              <div className="card">
                <strong>{current.customer.name}</strong>
                <span className="tiny muted" style={{ display: "block" }}>{current.customer.phone}</span>
                <span className="tiny muted" style={{ display: "block" }}>
                  {[current.customer.address.emirate, current.customer.address.area, current.customer.address.street,
                    current.customer.address.building, current.customer.address.flat].filter(Boolean).join(" · ")}
                </span>
              </div>

              <h2>الأصناف</h2>
              <div className="grid">
                {current.lines.map((l) => (
                  <div key={l.id} className="card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>
                        <strong>{l.title}</strong>
                        {l.subtitle && <span className="tiny muted" style={{ display: "block" }}>{l.subtitle}</span>}
                        {l.perfumeCode && <span className="tiny muted" style={{ display: "block" }}>كود الزيت: {l.perfumeCode}</span>}
                        <span className="tiny muted">{l.kind === "custom" ? "عطر مخصص" : "عطر جاهز"} · ×{l.quantity}</span>
                      </span>
                      <strong>{formatFils(lineTotalFils(l))}</strong>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted small">المجموع</span><span>{formatFils(current.subtotalFils)}</span>
                </div>
                {current.discountFils > 0 && (
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted small">خصم الكمية ({BULK_DISCOUNT_PERCENT}%)</span>
                    <span data-testid="order-discount">−{formatFils(current.discountFils)}</span>
                  </div>
                )}
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted small">الشحن</span>
                  <span>{current.shippingFils === 0 ? "مجاني" : formatFils(current.shippingFils)}</span>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted small">الإجمالي</span>
                  <strong data-testid="order-total">{formatFils(current.totalFils)}</strong>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted small">الدفع</span>
                  <strong data-testid="payment-status">{current.paymentStatus}</strong>
                </div>
                {!isProductionEligible(current) && (
                  <p className="tiny" style={{ color: "#991b1b", margin: "6px 0 0" }}>
                    غير مدفوع — لا يظهر في قائمة التصنيع.
                  </p>
                )}
              </div>

              <h2>حالة التصنيع</h2>
              <div className="grid two">
                {PRODUCTION.map((s) => (
                  <button key={s} className={`btn ${current.productionStatus === s ? "" : "ghost"}`} disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try { setOrder(await repository.setProductionStatus(current.orderNumber, s)); } finally { setBusy(false); }
                    }}>
                    {s}
                  </button>
                ))}
              </div>

              <h2>حالة الشحن</h2>
              <div className="grid two">
                {SHIPPING.map((s) => (
                  <button key={s} className={`btn ${current.shippingStatus === s ? "" : "ghost"}`} disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        // التسليم للناقل يولّد شحنة وإشعاراً — مسجّلين في الصادر، غير مُرسَلين.
                        const tracking = s === "handed_over" ? await notifyShipment(current) : undefined;
                        setOrder(await repository.setShippingStatus(current.orderNumber, s, tracking));
                      } finally { setBusy(false); }
                    }}>
                    {s}
                  </button>
                ))}
              </div>
              {current.trackingNumber && <p className="tiny muted">رقم التتبّع التجريبي: {current.trackingNumber}</p>}

              <Link className="btn ghost" to="/admin" style={{ display: "inline-block", marginTop: 14 }}>رجوع للطلبات</Link>
            </>
          );
        }}
      </Async>
    </AdminGate>
  );
}
