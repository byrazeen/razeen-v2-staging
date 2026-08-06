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
import { Iso, OrderNumber } from "@/components/text";
import { paymentLabel, productionLabel, shippingLabel } from "@/lib/statusLabels";

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
      <Async state={state} empty={<Empty title="ما لقينا هذا الطلب" headingLevel={1} action={<Link className="btn ghost" to="/admin" style={{ display: "inline-block", maxWidth: 200, marginTop: 12 }}>رجوع</Link>} />}>
        {() => {
          if (!current) return null;
          return (
            <>
              <h1><OrderNumber>{current.orderNumber}</OrderNumber></h1>
              <div className="card">
                <strong>{current.customer.name}</strong>
                <span className="tiny muted" style={{ display: "block" }}><Iso className="num">{current.customer.phone}</Iso></span>
                <span className="tiny muted" style={{ display: "block" }}>
                  {[current.customer.address.emirate, current.customer.address.area, current.customer.address.street,
                    current.customer.address.building, current.customer.address.flat].filter(Boolean).join(" · ")}
                </span>
              </div>

              <h2 className="eyebrow">الأصناف</h2>
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
                      <strong className="price">{formatFils(lineTotalFils(l))}</strong>
                    </div>
                  </div>
                ))}
              </div>

              <div className="panel" style={{ marginTop: 14 }}>
                <div className="sum">
                  <span>المجموع</span><span className="price">{formatFils(current.subtotalFils)}</span>
                </div>
                {current.discountFils > 0 && (
                  <div className="sum">
                    <span>خصم الكمية ({BULK_DISCOUNT_PERCENT}%)</span>
                    <span className="price" data-testid="order-discount">−{formatFils(current.discountFils)}</span>
                  </div>
                )}
                <div className="sum">
                  <span>الشحن</span>
                  <span className="price">{current.shippingFils === 0 ? "مجاني" : formatFils(current.shippingFils)}</span>
                </div>
                <div className="sum total">
                  <span>الإجمالي</span>
                  <strong className="price price-lg" data-testid="order-total">{formatFils(current.totalFils)}</strong>
                </div>
                <div className="sum">
                  <span>الدفع</span>
                  <strong data-testid="payment-status">{paymentLabel(current.paymentStatus)}</strong>
                </div>
                {!isProductionEligible(current) && (
                  <p className="tiny" style={{ color: "#991b1b", margin: "6px 0 0" }}>
                    غير مدفوع — لا يظهر في قائمة التصنيع.
                  </p>
                )}
              </div>

              <h2 className="eyebrow" id="production-label">حالة التصنيع</h2>
              <div className="chips" role="radiogroup" aria-labelledby="production-label">
                {PRODUCTION.map((s) => (
                  <button key={s} role="radio" aria-checked={current.productionStatus === s}
                    className={`chip ${current.productionStatus === s ? "sel" : ""}`.trim()} disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try { setOrder(await repository.setProductionStatus(current.orderNumber, s)); } finally { setBusy(false); }
                    }}>
                    {productionLabel(s)}
                  </button>
                ))}
              </div>

              <h2 className="eyebrow" id="shipping-label">حالة الشحن</h2>
              <div className="chips" role="radiogroup" aria-labelledby="shipping-label">
                {SHIPPING.map((s) => (
                  <button key={s} role="radio" aria-checked={current.shippingStatus === s}
                    className={`chip ${current.shippingStatus === s ? "sel" : ""}`.trim()} disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        // التسليم للناقل يولّد شحنة وإشعاراً — مسجّلين في الصادر، غير مُرسَلين.
                        const tracking = s === "handed_over" ? await notifyShipment(current) : undefined;
                        setOrder(await repository.setShippingStatus(current.orderNumber, s, tracking));
                      } finally { setBusy(false); }
                    }}>
                    {shippingLabel(s)}
                  </button>
                ))}
              </div>
              {current.trackingNumber && <p className="tiny muted">رقم التتبّع التجريبي: <OrderNumber>{current.trackingNumber}</OrderNumber></p>}

              <Link className="chip" to="/admin" style={{ display: "inline-flex", alignItems: "center", marginTop: 18 }}>رجوع للطلبات</Link>
            </>
          );
        }}
      </Async>
    </AdminGate>
  );
}
