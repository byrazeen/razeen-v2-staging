/**
 * قاعدة الكمية — تُقال حيث يُتَّخذ القرار.
 *
 * كانت تظهر في مكان واحد: نصّ رمادي صغير أسفل مجاميع السلة، بعد أن يكون العميل
 * قد اختار ما يشتريه. قرار شراء القارورة الثانية والثالثة يُتَّخذ وهو يتصفّح،
 * فالقاعدة تُعرض على الرفّ وعلى صفحة العطر أيضاً، وفي السلة تصير رابطاً يعيده
 * إلى الرفّ بدل أن تخبره بشيء لا يستطيع فعله من مكانه.
 *
 * الأرقام كلها من وحدة التسعير. لا حساب هنا.
 */
import { BULK_DISCOUNT_PERCENT, BULK_THRESHOLD_ITEMS } from "@/lib/pricing";
import { arabicCount, PERFUME_FORMS } from "@/lib/arabic";

/** «من 3 عطور فأكثر: الشحن مجاني وخصم 5%» — بمطابقة العدد الصحيحة. */
export function bulkRuleText(): string {
  return `من ${arabicCount(BULK_THRESHOLD_ITEMS, PERFUME_FORMS)} فأكثر: الشحن مجاني وخصم ${BULK_DISCOUNT_PERCENT}%`;
}

/**
 * بطاقة القاعدة على أسطح التصفّح. تأخذ خلية من شبكة الرفّ فتقول شيئاً مفيداً
 * في المكان الذي كان سيبقى فارغاً.
 */
export function BulkOfferCard() {
  return (
    <aside className="offer" aria-label="عرض الكمية">
      <span className="offer-mark" aria-hidden="true">
        <span /><span /><span />
      </span>
      <strong className="offer-line">{bulkRuleText()}</strong>
      <span className="tiny offer-sub">يُطبَّق تلقائياً في السلة — جاهز ومخصّص معاً.</span>
    </aside>
  );
}

/** سطر القاعدة داخل صفحة العطر. */
export function BulkOfferLine() {
  return <p className="offer-inline">{bulkRuleText()}</p>;
}
