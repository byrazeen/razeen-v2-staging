/**
 * Permanent staging marker. Not dismissible, not conditional on a feature flag:
 * the one thing it must never do is be absent on the day someone confuses this
 * with the real store.
 *
 * Styled as a warning, never as part of the brand: hazard stripes, red ground,
 * white text (8.7:1), pinned above every other layer.
 */
export function StagingBanner() {
  return (
    <div dir="rtl" role="status" aria-live="polite" className="staging">
      <span className="staging-chip">RAZEEN V2 STAGING</span>
      <span>بيئة تطوير — لا طلبات حقيقية ولا مدفوعات ولا رسائل</span>
    </div>
  );
}
