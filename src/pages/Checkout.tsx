/**
 * إتمام الطلب — بيانات العميل، تحقّق، ثم دفع وهمي بنتيجة مُختارة.
 *
 * لا مزوّد دفع ولا رسالة تُرسَل: كل شيء عبر المحوّلات الوهمية. نتيجة الدفع
 * تُختار هنا صراحةً لأن المسارين — النجاح والفشل — لازم يكونان قابلين للاختبار،
 * والفشل تحديداً هو ما لم يكن مختبَراً في الإنتاج.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "@/lib/cart";
import { formatFils, lineTotalFils, BULK_DISCOUNT_PERCENT } from "@/lib/pricing";
import { placeOrder, type CheckoutResult } from "@/lib/orderFlow";
import { setMockPaymentOutcome, type MockPaymentOutcome } from "@/adapters/mock";
import { Empty, FieldError } from "@/components/states";

const EMIRATES = ["دبي", "أبوظبي", "الشارقة", "عجمان", "أم القيوين", "رأس الخيمة", "الفجيرة"];

interface Form { name: string; phone: string; emirate: string; area: string; street: string; building: string; flat: string; }
type Errors = Partial<Record<keyof Form, string>>;

/** التحقّق كله هنا: الرقم إماراتي، والعنوان مُهيكل من لحظة كتابته. */
function validate(form: Form): Errors {
  const errors: Errors = {};
  if (form.name.trim().length < 3) errors.name = "اكتب الاسم الثلاثي أو اسمين على الأقل.";
  const phone = form.phone.replace(/[\s-]/g, "");
  if (!/^(?:\+?971|0)?5\d{8}$/.test(phone)) errors.phone = "رقم إماراتي غير صحيح — مثال: 0501234567";
  if (!form.emirate) errors.emirate = "اختر الإمارة.";
  if (form.area.trim().length < 2) errors.area = "اكتب المنطقة.";
  if (form.street.trim().length < 2) errors.street = "اكتب الشارع.";
  if (form.building.trim().length < 1) errors.building = "اكتب المبنى.";
  return errors;
}

export default function Checkout() {
  const cart = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>({ name: "", phone: "", emirate: "", area: "", street: "", building: "", flat: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [outcome, setOutcome] = useState<MockPaymentOutcome>("success");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);

  const totals = cart.totals;
  const money = formatFils;
  /** التصحيح يُخفي رسالة الحقل فوراً — رسالة خطأ باقية على حقل صحيح تُربك أكثر مما تُرشد. */
  const set = (key: keyof Form) => (e: { target: { value: string } }) => {
    const next = { ...form, [key]: e.target.value };
    setForm(next);
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: validate(next)[key] }));
  };

  if (result) {
    return (
      <>
        <h1>{result.paid ? "تم الطلب" : "لم يكتمل الدفع"}</h1>
        <div className="card" role="status">
          <span className={`tag ${result.paid ? "ok" : "warn"}`}>{result.paid ? "مدفوع" : "غير مدفوع"}</span>
          <strong style={{ display: "block", marginTop: 8 }}>رقم الطلب: <span className="num">{result.order.orderNumber}</span></strong>
          <p className="small" style={{ margin: "8px 0 0" }} data-testid="checkout-message">{result.message}</p>
          <p className="tiny muted" style={{ margin: "6px 0 0" }}>
            حالة الدفع: {result.order.paymentStatus} · حالة التصنيع: {result.order.productionStatus}
          </p>
        </div>
        <div className="grid two" style={{ marginTop: 14 }}>
          <Link className="btn ghost" to="/outbox">شوف الرسائل المسجّلة</Link>
          <Link className="btn ghost" to="/admin">لوحة الإدارة</Link>
        </div>
        <div className="actionbar">
          <button className="btn" onClick={() => navigate("/")}>رجوع للرئيسية</button>
        </div>
      </>
    );
  }

  if (cart.lines.length === 0) {
    return <Empty title="ما في شي لإتمامه" hint="سلتك فاضية."
      action={<Link className="btn" to="/" style={{ maxWidth: 240, margin: "14px auto 0" }}>ابدأ التسوّق</Link>} />;
  }

  return (
    <>
      <h1>إتمام الطلب</h1>
      <p className="placeholder-price">واجهة تجريبية — لا دفع حقيقي ولا رسائل</p>

      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const found = validate(form);
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          setBusy(true);
          setMockPaymentOutcome(outcome);
          try {
            const res = await placeOrder(cart.lines, {
              name: form.name.trim(),
              phone: form.phone.replace(/[\s-]/g, ""),
              address: {
                emirate: form.emirate, area: form.area.trim(), street: form.street.trim(),
                building: form.building.trim(), flat: form.flat.trim() || undefined,
              },
            });
            setResult(res);
            // السلة تُفرَّغ عند النجاح فقط — الفشل يجب أن يبقي للعميل ما يعيد المحاولة به.
            if (res.paid) cart.clear();
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="eyebrow">بياناتك</p>
        <div className="grid">
          <div>
            <label htmlFor="name" className="small muted">الاسم</label>
            <input id="name" className="field" value={form.name} onChange={set("name")} style={{ marginTop: 4 }} />
            <FieldError message={errors.name} />
          </div>
          <div>
            <label htmlFor="phone" className="small muted">رقم الجوال</label>
            <input id="phone" className="field" inputMode="tel" value={form.phone} onChange={set("phone")} placeholder="0501234567" style={{ marginTop: 4 }} />
            <FieldError message={errors.phone} />
          </div>
          <div>
            <label htmlFor="emirate" className="small muted">الإمارة</label>
            <select id="emirate" className="field" value={form.emirate} onChange={set("emirate")} style={{ marginTop: 4 }}>
              <option value="">اختر الإمارة</option>
              {EMIRATES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <FieldError message={errors.emirate} />
          </div>
          <div>
            <label htmlFor="area" className="small muted">المنطقة</label>
            <input id="area" className="field" value={form.area} onChange={set("area")} style={{ marginTop: 4 }} />
            <FieldError message={errors.area} />
          </div>
          <div>
            <label htmlFor="street" className="small muted">الشارع</label>
            <input id="street" className="field" value={form.street} onChange={set("street")} style={{ marginTop: 4 }} />
            <FieldError message={errors.street} />
          </div>
          <div className="grid two">
            <div>
              <label htmlFor="building" className="small muted">المبنى</label>
              <input id="building" className="field" value={form.building} onChange={set("building")} style={{ marginTop: 4 }} />
              <FieldError message={errors.building} />
            </div>
            <div>
              <label htmlFor="flat" className="small muted">الشقة (اختياري)</label>
              <input id="flat" className="field" value={form.flat} onChange={set("flat")} style={{ marginTop: 4 }} />
            </div>
          </div>
        </div>

        <p className="eyebrow">الملخّص</p>
        <div className="panel">
          {cart.lines.map((l) => (
            <div key={l.id} className="sum">
              <span>{l.title} ×<span className="num">{l.quantity}</span></span>
              <span className="price small">{money(lineTotalFils(l))}</span>
            </div>
          ))}
          <div className="sum">
            <span>المجموع</span><span className="price" data-testid="checkout-subtotal">{money(totals.subtotalFils)}</span>
          </div>
          {totals.discountFils > 0 && (
            <div className="sum">
              <span>خصم الكمية ({BULK_DISCOUNT_PERCENT}%)</span>
              <span className="price" data-testid="checkout-discount">−{money(totals.discountFils)}</span>
            </div>
          )}
          <div className="sum">
            <span>الشحن</span><span className="price" data-testid="checkout-shipping">{totals.shippingFils === 0 ? "مجاني" : money(totals.shippingFils)}</span>
          </div>
          <div className="sum total">
            <span>الإجمالي</span><strong className="price price-lg" data-testid="checkout-total">{money(totals.totalFils)}</strong>
          </div>
        </div>

        <p className="eyebrow">نتيجة الدفع التجريبي</p>
        <p className="tiny muted" style={{ marginTop: 0 }}>staging فقط: اختر النتيجة كي يُختبر المساران.</p>
        <div className="grid two">
          <button type="button" className={`btn ${outcome === "success" ? "sel" : "ghost"}`} onClick={() => setOutcome("success")} data-testid="outcome-success">نجاح الدفع</button>
          <button type="button" className={`btn ${outcome === "failure" ? "sel" : "ghost"}`} onClick={() => setOutcome("failure")} data-testid="outcome-failure">فشل الدفع</button>
        </div>

        <div className="actionbar">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "جاري المعالجة…" : "ادفع (تجريبي)"}
          </button>
        </div>
      </form>
    </>
  );
}
