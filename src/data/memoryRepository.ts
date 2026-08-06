/**
 * التنفيذ في الذاكرة — the in-memory (and localStorage) implementation.
 *
 * هذا هو المصدر الاحتياطي: يعمل بلا شبكة وبلا إعداد، ويُستعمل حين لا تكون
 * متغيّرات Supabase موجودة. لا اتصال شبكي هنا إطلاقاً.
 *
 * No network call here, by design. Used whenever the Supabase environment is
 * absent. Selection between this and Supabase happens in `repositorySource.ts`.
 */
import type {
  PaymentStatus, ProductionStatus, ShippingStatus, StructuredAddress,
} from "@/config/customOrderContract";
import { customOils, products } from "@/data/mock";
import {
  isProductionEligible,
  type Order, type OrderDraft, type OrderLine,
  type PlaceOrderRequest, type RazeenRepository,
} from "@/data/repositoryContract";
import { buildOrderDraft } from "@/lib/orderDraft";
import { customPriceFils, dirhamsToFils, readyMadePriceFils, totals as pricingTotals } from "@/lib/pricing";
import seed from "../../seed/seed.json";

const LATENCY_MS = 140;
const STORAGE_KEY = "razeen_v2_staging_orders_v2";

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
      unitPriceFils: dirhamsToFils(it.unit_price),
      quantity: it.qty,
    }));
    // نفس الحساب المعتمد — بيانات البذرة لا تُستثنى من السياسة.
    const t = pricingTotals(lines);
    return {
      orderNumber: o.order_number,
      createdAt: "2026-01-05T09:00:00.000Z",
      customer,
      lines,
      subtotalFils: t.subtotalFils,
      discountFils: t.discountFils,
      shippingFils: t.shippingFils,
      totalFils: t.totalFils,
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
      unitPriceFils: dirhamsToFils(o.unit_price),
      quantity: o.quantity,
      perfumeCode: o.perfume_code,
      size: o.bottle_size,
    }];
    const t = pricingTotals(lines);
    return {
      orderNumber: o.order_number,
      createdAt: "2026-01-06T11:30:00.000Z",
      customer,
      lines,
      subtotalFils: t.subtotalFils,
      discountFils: t.discountFils,
      shippingFils: t.shippingFils,
      totalFils: t.totalFils,
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

/** سلة الاحتياط. محلية بالكامل لأن هذا التنفيذ بلا شبكة أصلاً. */
const CART_KEY = "razeen_v2_staging_cart_v2";

function loadLocalCart(): OrderLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as OrderLine[]) : [];
  } catch { return []; }
}

/**
 * مفاتيح المحاولات المستهلكة. نفس ضمان `place_order` في القاعدة، منفّذاً هنا
 * كي يتصرّف المسار الاحتياطي كما يتصرّف الحقيقي: نقرتان بمفتاح واحد = طلب واحد.
 */
const placedByKey = new Map<string, string>();

/** الطلب المحلي يُسعَّر من وحدة التسعير — نفس أرقام السياسة، بلا حساب هنا. */
function linesFor(request: PlaceOrderRequest): OrderLine[] {
  return request.items.map((item) => {
    if (item.kind === "ready") {
      const product = products.find((p) => p.handle === item.handle);
      return {
        id: `ready:${item.handle}`,
        kind: "ready" as const,
        title: product?.title ?? item.handle ?? "",
        unitPriceFils: readyMadePriceFils(product?.priceFils) ?? 0,
        quantity: item.quantity,
      };
    }
    const oil = customOils.find((o) => o.code === item.catalogCode);
    const title = oil ? `${oil.brand} — ${oil.name}` : (item.freeText ?? "");
    return {
      id: `custom:${item.catalogCode ?? "unlisted"}:${item.size ?? ""}:${title}`,
      kind: "custom" as const,
      title,
      subtitle: item.size,
      unitPriceFils: customPriceFils(item.size) ?? 0,
      quantity: item.quantity,
      perfumeCode: item.catalogCode,
      size: item.size,
    };
  });
}

export interface MemoryRepository extends RazeenRepository {
  /** موجود للاختبارات ولمسار `placeOrder` المحلي وحده — ليس جزءاً من العقد. */
  createOrder(draft: OrderDraft): Promise<Order>;
}

export const mockRepository: MemoryRepository = {
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

  /**
   * نفس عقد `place_order`: البنود بلا سعر، والتسعير هنا من وحدة السياسة،
   * والمفتاح نفسه يُعيد الطلب نفسه.
   */
  async placeOrder(request) {
    const seen = placedByKey.get(request.idempotencyKey);
    if (seen) {
      const existing = load().find((o) => o.orderNumber === seen);
      if (existing) return wait(existing);
    }
    const lines = linesFor(request);
    const created = await this.createOrder(buildOrderDraft(lines, {
      name: request.customer.name,
      phone: request.customer.phone,
      address: request.customer.address,
    }));
    placedByKey.set(request.idempotencyKey, created.orderNumber);
    // الدفع المحاكى يُطبَّق فوراً كما تفعل الدالة في القاعدة: النجاح يدفع
    // ويُدخل التصنيع، والفشل يبقي الطلب خارجهما.
    return this.setPaymentStatus(created.orderNumber, request.outcome === "success" ? "paid" : "failed");
  },

  // السلة في هذا التنفيذ محلية بالكامل — لا شبكة هنا بحكم التصميم.
  loadCart: () => wait(loadLocalCart()),
  async saveCart(lines) {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch { /* تخزين غير متاح */ }
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
