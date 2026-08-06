/**
 * أسماء الحالات بالعربية — مصدر واحد لكل الأسطح.
 *
 * حالة الدفع كانت مترجمة في لوحة الإدارة وحدها، بينما تظهر حالتا التصنيع والشحن
 * خامًا: «التصنيع: queued» و«الشحن: not_shipped» داخل جملة عربية. الرمز يبقى كما
 * هو في البيانات وفي تصدير CSV — العربية للعرض فقط.
 */
import type { ProductionStatus, ShippingStatus } from "@/config/customOrderContract";

export const PAYMENT_LABEL: Record<string, string> = {
  paid: "مدفوع", unpaid: "غير مدفوع", failed: "فشل الدفع", refunded: "مسترجع",
};

export const PRODUCTION_LABEL: Record<ProductionStatus | string, string> = {
  not_started: "لم يبدأ",
  queued: "في الطابور",
  oil_ready: "الزيت جاهز",
  mixed: "مُركَّب",
  bottled: "مُعبَّأ",
  ready: "جاهز",
};

export const SHIPPING_LABEL: Record<ShippingStatus | string, string> = {
  not_shipped: "لم يُشحن",
  handed_over: "سُلّم للناقل",
  in_transit: "في الطريق",
  delivered: "وصل",
  returned: "مُرتجع",
};

export const productionLabel = (s: string) => PRODUCTION_LABEL[s] ?? s;
export const shippingLabel = (s: string) => SHIPPING_LABEL[s] ?? s;
export const paymentLabel = (s: string) => PAYMENT_LABEL[s] ?? s;
