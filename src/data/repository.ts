/**
 * طبقة الوصول للبيانات — الواجهة كلها تمر من هنا.
 *
 * الصفحات لا تعرف من أين تأتي البيانات: اليوم `src/data/mock.ts` و`seed.json`،
 * وغداً Supabase. المهم أن استبدال التنفيذ لا يفتح أي ملف في `src/pages`.
 *
 * The pages depend on the `RazeenRepository` interface only. A Supabase-backed
 * implementation drops in behind the same interface later — no page changes.
 * There is deliberately NO network call and NO Supabase client here yet.
 */
import type {
  PaymentStatus, ProductionStatus, ShippingStatus, StructuredAddress,
} from "@/config/customOrderContract";
import { customOils, products, type CustomOil, type Product } from "@/data/mock";
import seed from "../../seed/seed.json";

export interface OrderLine {
  id: string;
  kind: "ready" | "custom";
  title: string;
  subtitle?: string;
  unitPrice: number;
  quantity: number;
  /** كود الزيت للعطر المخصص — الحقل الذي يطلب به المشغل فعلياً. */
  perfumeCode?: string;
  size?: string;
  isPlaceholderPrice?: boolean;
}

export interface Order {
  orderNumber: string;
  createdAt: string;
  customer: { name: string; phone: string; address: StructuredAddress };
  lines: OrderLine[];
  subtotal: number;
  shipping: number;
  total: number;
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

const LATENCY_MS = 140;
const STORAGE_KEY = "razeen_v2_staging_orders";

/** حالة الخطأ قابلة للتشغيل يدوياً: `?stgFail=1` على أي صفحة. */
function shouldFail(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("stgFail") === "1";
}

const wait = <T,>(value: T): Promise<T> =>
  new Promise((resolve, reject) =>
    setTimeout(() => (shouldFail() ? reject(new Error("تعذّر جلب البيانات (محاكاة خطأ في staging)")) : resolve(value)), LATENCY_MS)
  );

const emptyAddress = (emirate: string): StructuredAddress => ({
  emirate, area: "منطقة تجريبية", street: "شارع الاختبار", building: "مبنى تجريبي",
});

type SeedCustomer = { name: string; phone: string; address: StructuredAddress };
const seedCustomers = seed.customers as SeedCustomer[];
const customerByPhone = (phone: string): SeedCustomer =>
  seedCustomers.find((c) => c.phone === phone) ?? { name: "عميل تجريبي", phone, address: emptyAddress("دبي") };

/** طلبات البذرة، مُحوَّلة إلى الشكل الواحد الذي يعرفه التطبيق. */
function seedOrders(): Order[] {
  const ready: Order[] = (seed.orders as Array<{
    order_number: string; phone: string; payment_status: string; status: string; total: number;
    items: Array<{ handle: string; qty: number; unit_price: number }>;
  }>).map((o) => {
    const customer = customerByPhone(o.phone);
    const lines: OrderLine[] = o.items.map((it) => ({
      id: `ready:${it.handle}`,
      kind: "ready",
      title: products.find((p) => p.handle === it.handle)?.title ?? it.handle,
      unitPrice: it.unit_price,
      quantity: it.qty,
    }));
    const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    return {
      orderNumber: o.order_number,
      createdAt: "2026-01-05T09:00:00.000Z",
      customer,
      lines,
      subtotal,
      shipping: 0,
      total: subtotal,
      currency: "AED",
      paymentStatus: (o.payment_status === "paid" ? "paid" : "unpaid") as PaymentStatus,
      productionStatus: (o.status === "delivered" ? "ready" : o.payment_status === "paid" ? "queued" : "not_started") as ProductionStatus,
      shippingStatus: (o.status === "delivered" ? "delivered" : "not_shipped") as ShippingStatus,
      trackingNumber: null,
    };
  });

  const custom: Order[] = (seed.custom_orders as Array<{
    order_number: string; phone: string; perfume_code: string; perfume_brand: string; perfume_name: string;
    bottle_size: string; quantity: number; unit_price: number; payment_status: string;
    production_status: string; shipping_status: string; customer_notes: string | null;
  }>).map((o) => {
    const customer = customerByPhone(o.phone);
    const lines: OrderLine[] = [{
      id: `custom:${o.perfume_code}:${o.bottle_size}`,
      kind: "custom",
      title: `${o.perfume_brand} — ${o.perfume_name}`,
      subtitle: `${o.bottle_size}${o.customer_notes ? ` · ${o.customer_notes}` : ""}`,
      unitPrice: o.unit_price,
      quantity: o.quantity,
      perfumeCode: o.perfume_code,
      size: o.bottle_size,
      isPlaceholderPrice: true,
    }];
    const subtotal = o.unit_price * o.quantity;
    return {
      orderNumber: o.order_number,
      createdAt: "2026-01-06T11:30:00.000Z",
      customer,
      lines,
      subtotal,
      shipping: 0,
      total: subtotal,
      currency: "AED",
      paymentStatus: o.payment_status as PaymentStatus,
      productionStatus: o.production_status as ProductionStatus,
      shippingStatus: o.shipping_status as ShippingStatus,
      trackingNumber: null,
    };
  });

  return [...ready, ...custom];
}

/**
 * مخزن staging: في الذاكرة، ويُحفظ في localStorage كي يبقى الطلب ظاهراً في لوحة
 * الإدارة بعد إعادة التحميل. لا شبكة، ولا بيانات حقيقية.
 */
let store: Order[] | null = null;

function load(): Order[] {
  if (store) return store;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) { store = JSON.parse(raw) as Order[]; return store; }
    } catch { /* تخزين غير متاح — نكمل بالذاكرة */ }
  }
  store = seedOrders();
  return store;
}

function persist(): void {
  if (typeof window === "undefined" || !store) return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* تجاهل */ }
}

function mutate(orderNumber: string, patch: Partial<Order>): Order {
  const orders = load();
  const index = orders.findIndex((o) => o.orderNumber === orderNumber);
  if (index < 0) throw new Error(`لا يوجد طلب بالرقم ${orderNumber}`);
  orders[index] = { ...orders[index], ...patch };
  persist();
  return orders[index];
}

let counter = 0;
const nextOrderNumber = () => `STG-${Date.now().toString().slice(-6)}${(++counter).toString().padStart(2, "0")}`;

export const mockRepository: RazeenRepository = {
  listProducts: () => wait(products),
  getProduct: (handle) => wait(products.find((p) => p.handle === handle) ?? null),
  listOils: () => wait(customOils),
  listOrders: () => wait([...load()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getOrder: (orderNumber) => wait(load().find((o) => o.orderNumber === orderNumber) ?? null),

  async createOrder(draft) {
    const order: Order = {
      ...draft,
      orderNumber: nextOrderNumber(),
      createdAt: new Date().toISOString(),
      // يبدأ كل طلب غير مدفوع. الدفع يرقّيه، ولا شيء غيره.
      paymentStatus: "unpaid",
      productionStatus: "not_started",
      shippingStatus: "not_shipped",
      trackingNumber: null,
    };
    load().push(order);
    persist();
    return wait(order);
  },

  setPaymentStatus: (orderNumber, status) =>
    wait(mutate(orderNumber, {
      paymentStatus: status,
      // الدفع الناجح وحده يفتح باب التصنيع.
      ...(status === "paid" ? { productionStatus: "queued" as ProductionStatus } : {}),
    })),

  setProductionStatus: (orderNumber, status) => wait(mutate(orderNumber, { productionStatus: status })),

  setShippingStatus: (orderNumber, status, trackingNumber) =>
    wait(mutate(orderNumber, { shippingStatus: status, ...(trackingNumber ? { trackingNumber } : {}) })),

  // قائمة التصنيع = المدفوع فقط. أي فلترة أخرى تُدخل طلباً لم يُدفع إلى المشغل.
  listProductionQueue: () => wait(load().filter(isProductionEligible)),
};

/** نقطة الوصول الوحيدة للصفحات. تُستبدل لاحقاً بتنفيذ Supabase دون لمس الصفحات. */
export const repository: RazeenRepository = mockRepository;
