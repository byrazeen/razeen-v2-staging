/** Loading, empty and error, written once so no screen invents its own. */
import type { ReactNode } from "react";
import { READ_ERROR_MESSAGE, type AsyncState } from "@/lib/useAsync";

export function Loading({ label = "جاري التحميل…" }: { label?: string }) {
  return (
    <div className="grid" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="sk" /><div className="sk" /><div className="sk" />
    </div>
  );
}

/**
 * عنوان الحالة عنوانٌ حقيقي لا فقرة مُنسَّقة: /cart و/checkout كانا يعرضان صفراً
 * من العناوين حين تفرغ السلة، فلا يجد قارئ الشاشة أي مرساة في الصفحة.
 */
export function Empty({ title, hint, action, headingLevel = 1 }: { title: string; hint?: string; action?: ReactNode; headingLevel?: 1 | 2 }) {
  const H = (headingLevel === 1 ? "h1" : "h2") as "h1" | "h2";
  return (
    <div className="state">
      <H className="state-title">{title}</H>
      {hint && <p className="muted small" style={{ marginTop: 0 }}>{hint}</p>}
      {action}
    </div>
  );
}

/**
 * حالة الخطأ كما يراها عميل، لا كما يراها مصحِّح أخطاء.
 *
 * `hint` نصٌّ مكتوب للعميل بالعربية — لا `error.message` ولا نصّ استثناء.
 * كانت الشاشة تعرض حرفياً «Supabase products: TypeError: Failed to fetch»:
 * إنجليزية داخل متجر عربي، وتكشف المزوّد واسم الجدول، وتقرأ كأن الموقع
 * معطوب. التفصيل التقني صار في `console.error` داخل `useAsync` وحده.
 */
export function ErrorState({ title = "صار خطأ", hint = READ_ERROR_MESSAGE, onRetry, headingLevel = 2 }: { title?: string; hint?: string; onRetry?: () => void; headingLevel?: 1 | 2 }) {
  const H = (headingLevel === 1 ? "h1" : "h2") as "h1" | "h2";
  return (
    <div className="state" role="alert">
      <H className="state-title">{title}</H>
      {hint && <p className="muted small" style={{ marginTop: 0 }}>{hint}</p>}
      {onRetry && <button className="btn ghost" onClick={onRetry} style={{ maxWidth: 220, margin: "14px auto 0" }}>حاول مرة ثانية</button>}
    </div>
  );
}

/**
 * الحالات الثلاث في مكان واحد: تحميل، ثم خطأ، ثم فراغ، ثم البيانات.
 * الصفحة تصف حالة النجاح فقط.
 */
export function Async<T>({
  state, empty, isEmpty, children, loadingLabel,
}: {
  state: AsyncState<T>;
  empty?: ReactNode;
  isEmpty?: (data: NonNullable<T>) => boolean;
  children: (data: NonNullable<T>) => ReactNode;
  loadingLabel?: string;
}) {
  if (state.loading) return <Loading label={loadingLabel} />;
  // `state.error` نصّ عميل جاهز من useAsync — لا استثناء خام يمرّ من هنا.
  if (state.error) return <ErrorState hint={state.error} onRetry={state.reload} />;
  // null = لا يوجد سجل: تُعامَل كحالة فراغ، فالصفحة لا ترى قيمة فارغة أبداً.
  if (state.data === null || state.data === undefined) return <>{empty ?? <Empty title="لا توجد بيانات" />}</>;
  const data = state.data as NonNullable<T>;
  if (isEmpty?.(data)) return <>{empty ?? <Empty title="لا توجد بيانات" />}</>;
  return <>{children(data)}</>;
}

/**
 * رسالة تحقّق تحت حقل.
 *
 * المُعرِّف إلزامي: الحقل يشير إليه بـaria-describedby، وبدون ذلك تبقى الرسالة
 * مرئية وغير مربوطة بشيء — يسمعها قارئ الشاشة ستّ مرات دفعة واحدة بلا أن يعرف
 * أيّ حقل تخصّ. `role="alert"` يبقى للتصحيح أثناء الكتابة، لا للإرسال الفارغ:
 * الإرسال ينقل التركيز إلى أول حقل غير صالح فتُقرأ رسالته من وصف الحقل نفسه.
 */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="tiny" style={{ color: "var(--danger)", margin: "4px 0 0", fontWeight: 700 }}>{message}</p>;
}
