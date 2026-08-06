/**
 * تحويل سطور السلة إلى مسوّدة طلب — بحساب واحد لا يُعاد في أي مكان.
 *
 * هذه الدالة هي الجسر بين ما يراه العميل وما يُحفظ في قاعدة البيانات: كلاهما
 * يخرج من `totals()` نفسها، فلا يمكن أن يفترق المعروض عن المخزَّن.
 */
import type { OrderDraft, OrderLine } from "@/data/repositoryContract";
import type { StructuredAddress } from "@/config/customOrderContract";
import { isPurchasable, totals } from "@/lib/pricing";

export interface OrderCustomer {
  name: string;
  phone: string;
  address: StructuredAddress;
}

/** يبني المسوّدة من نفس السطور ونفس الحساب الذي عُرض للعميل. */
export function buildOrderDraft(lines: OrderLine[], customer: OrderCustomer): OrderDraft {
  // السطور المحفوظة هي المُسعَّرة نفسها. `totals()` تستبعد ما لا سعر له، فلو
  // حُفظت السطور كما وردت لحمل الطلب سطراً بصفر لا يدخل مجموعه — سجلٌّ يناقض
  // نفسه أمام موظف التشغيل. المصدر واحد، فليكن المحفوظ واحداً معه.
  const priced = lines.filter((l) => isPurchasable(l.unitPriceFils));
  const t = totals(priced);
  return {
    customer,
    lines: priced,
    subtotalFils: t.subtotalFils,
    discountFils: t.discountFils,
    shippingFils: t.shippingFils,
    totalFils: t.totalFils,
    currency: t.currency,
  };
}
