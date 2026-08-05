/**
 * Permanent staging marker. Not dismissible, not conditional on a feature flag:
 * the one thing it must never do is be absent on the day someone confuses this
 * with the real store.
 */
export function StagingBanner() {
  return (
    <div
      dir="rtl"
      role="status"
      aria-live="polite"
      style={{
        position: "sticky", top: 0, zIndex: 2147483647,
        background: "repeating-linear-gradient(45deg,#7f1d1d,#7f1d1d 12px,#991b1b 12px,#991b1b 24px)",
        color: "#fff", textAlign: "center", padding: "6px 12px",
        fontSize: 13, fontWeight: 700, letterSpacing: ".04em",
      }}
    >
      RAZEEN V2 — STAGING · بيئة تطوير · لا طلبات حقيقية ولا مدفوعات ولا رسائل
    </div>
  );
}
