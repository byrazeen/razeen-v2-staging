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

export interface RazeenRepository {
  listProducts(): Promise<Product[]>;
  getProduct(handle: string): Promise<Product | null>;
  listOils(): Promise<CustomOil[]>;
  listOrders(): Promise<Order[]>;
  getOrder(orderNumber: string): Promise<Order | null>;
  createOrder(draft: OrderDraft): Promise<Order>;
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

