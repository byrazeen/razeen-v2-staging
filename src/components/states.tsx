/** Loading, empty and error, written once so no screen invents its own. */
import type { ReactNode } from "react";
import type { AsyncState } from "@/lib/useAsync";

export function Loading({ label = "جاري التحميل…" }: { label?: string }) {
  return (
    <div className="grid" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>{label}</span>
      <div className="sk" /><div className="sk" /><div className="sk" />
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <p style={{ fontWeight: 700, marginBottom: 6 }}>{title}</p>
      {hint && <p className="muted small" style={{ marginTop: 0 }}>{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "صار خطأ", hint, onRetry }: { title?: string; hint?: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <p style={{ fontWeight: 700, marginBottom: 6 }}>{title}</p>
      {hint && <p className="muted small" style={{ marginTop: 0 }}>{hint}</p>}
      {onRetry && <button className="btn ghost" onClick={onRetry} style={{ maxWidth: 220, margin: "10px auto 0" }}>حاول مرة ثانية</button>}
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
  if (state.error) return <ErrorState hint={state.error} onRetry={state.reload} />;
  // null = لا يوجد سجل: تُعامَل كحالة فراغ، فالصفحة لا ترى قيمة فارغة أبداً.
  if (state.data === null || state.data === undefined) return <>{empty ?? <Empty title="لا توجد بيانات" />}</>;
  const data = state.data as NonNullable<T>;
  if (isEmpty?.(data)) return <>{empty ?? <Empty title="لا توجد بيانات" />}</>;
  return <>{children(data)}</>;
}

/** رسالة تحقّق تحت حقل. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="tiny" role="alert" style={{ color: "#991b1b", margin: "4px 0 0" }}>{message}</p>;
}
