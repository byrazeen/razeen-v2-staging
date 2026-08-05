/** Loading, empty and error, written once so no screen invents its own. */
export function Loading({ label = "جاري التحميل…" }: { label?: string }) {
  return (
    <div className="grid" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>{label}</span>
      <div className="sk" /><div className="sk" /><div className="sk" />
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
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
