/**
 * عقد طبقة البيانات — الأنواع وحدها، بلا أي تنفيذ.
 *
 * فُصل العقد عن تنفيذه كي يستورده تنفيذان (الذاكرة وSupabase) دون أن يستورد
 * أحدهما الآخر. الصفحات لا تستورد هذا الملف مباشرة؛ تستورد `@/data/repository`.
 *
 * Types only. Two implementations (in-memory and Supabase) depend on this file,
 * and on nothing of each other. Pages keep importing `@/data/repository`.
 */
import type {
  PaymentStatus, ProductionStatus, ShippingStatus, StructuredAddress,
} from "@/config/customOrderContract";
import type { CustomOil, Product } from "@/data/mock";

export interface OrderLine {
  id: string;
  kind: "ready" | "custom";
  title: string;
  subtitle?: string;
  /** سعر الوحدة بالفلس الصحيح. لا يدخل السلة سطر بلا سعر صالح (> 0). */
  unitPriceFils: number;
  quantity: number;
  /** كود الزيت للعطر المخصص — الحقل الذي يطلب به المشغل فعلياً. */
  perfumeCode?: string;
  size?: string;
}

export interface Order {
  orderNumber: string;
  createdAt: string;
  customer: { name: string; phone: string; address: StructuredAddress };
  lines: OrderLine[];
  /** كل المبالغ بالفلس الصحيح، كما في القاعدة تماماً. */
  subtotalFils: number;
  discountFils: number;
  shippingFils: number;
  totalFils: number;
  currency: "AED";
  paymentStatus: PaymentStatus;
  productionStatus: ProductionStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string | null;
}

export type OrderDraft = Omit<
  Order,
  "orderNumber" | "createdAt" | "paymentStatus" | "productionStatus" | "shippingStatus"
>;

/**
 * بندٌ في طلبٍ يُنشأ — **بلا سعر، عمداً**.
 *
 * هذا الشكل هو الفارق كله بين التصميم السابق وهذا: المتصفّح يقول «ماذا» —
 * أي عطر، أي مقاس، كم — ولا يقول «بكم». السعر يُحسب في `place_order` من
 * القاعدة، فلا يوجد حقل يستطيع العميل أن يكذب فيه أصلاً. وحدة التسعير في
 * `@/lib/pricing` تبقى للعرض في السلة وحده.
 */
export interface PlaceOrderItem {
  kind: "ready" | "custom";
  /** الجاهز: مقبض المنتج. يُترجَم إلى `variant_id` في طبقة البيانات. */
  handle?: string;
  /** المخصص: رمز الزيت في الكتالوج. */
  catalogCode?: string;
  /** المخصص: العطر الذي كتبه العميل بنفسه حين لا يجد رمزاً. */
  freeText?: string;
  size?: string;
  quantity: number;
  notes?: string;
}

export interface PlaceOrderRequest {
  items: PlaceOrderItem[];
  customer: { name: string; phone: string; address: StructuredAddress };
  /**
   * مفتاح المحاولة الواحدة. يُولَّد مرة عند بدء الدفع ويُعاد استعماله عند
   * إعادة الإرسال — فالنقرة الثانية تُعيد الطلب الأول ولا تُنشئ ثانياً.
   */
  idempotencyKey: string;
  /** نتيجة الدفع المحاكاة في staging. */
  outcome: "success" | "failed";
}

export interface RazeenRepository {
  listProducts(): Promise<Product[]>;
  getProduct(handle: string): Promise<Product | null>;
  listOils(): Promise<CustomOil[]>;
  listOrders(): Promise<Order[]>;
  getOrder(orderNumber: string): Promise<Order | null>;
  /**
   * المسار الوحيد لإنشاء طلب. المجاميع في الطلب العائد هي مجاميع القاعدة،
   * وهي وحدها ما يُعرض في شاشة التأكيد.
   */
  placeOrder(request: PlaceOrderRequest): Promise<Order>;
  /**
   * السلة الخادمية. `loadCart` هي **المصدر** — ما يعود منها يغلب أي نسخة
   * محلية، بلا استثناء ولا دمج.
   */
  loadCart(): Promise<OrderLine[]>;
  saveCart(lines: OrderLine[]): Promise<void>;
  setPaymentStatus(orderNumber: string, status: PaymentStatus): Promise<Order>;
  setProductionStatus(orderNumber: string, status: ProductionStatus): Promise<Order>;
  setShippingStatus(orderNumber: string, status: ShippingStatus, trackingNumber?: string): Promise<Order>;
  /**
   * قائمة التصنيع — **الطلبات المدفوعة فقط**.
   * القاعدة صلبة: طلب غير مدفوع أو فشل دفعه لا يدخل الإنتاج أبداً.
   */
  listProductionQueue(): Promise<Order[]>;
}

/** الشرط الوحيد لدخول قائمة التصنيع. مكتوب مرة واحدة كي لا يُعاد تفسيره. */
export const isProductionEligible = (order: Order): boolean => order.paymentStatus === "paid";

