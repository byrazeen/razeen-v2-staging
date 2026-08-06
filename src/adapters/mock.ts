/**
 * Staging implementations. They record what would have happened and return a
 * plausible shape, so the whole order journey is exercisable end to end without
 * a dirham moving or a customer being messaged.
 */
import { formatFils } from "../lib/pricing";
import type {
  AdapterMode, AdapterResult, AnalyticsAdapter, EmailAdapter,
  MessagingAdapter, PaymentAdapter, PaymentIntent, ShippingAdapter,
} from "./types";

export interface OutboundCall {
  adapter: string;
  method: string;
  payload: unknown;
  at: number;
  /** القناة والمستلم والنص — تُملأ لكل رسالة كان سيراها عميل. */
  channel?: "whatsapp" | "email" | "shipping" | "payment" | "analytics";
  to?: string;
  subject?: string;
  body?: string;
}

/**
 * Everything staging *would* have sent. Read by tests, by /outbox and by the
 * STAGING banner. يُحفظ في localStorage كي يبقى السجل بعد إعادة التحميل — سجل
 * يختفي عند أول تحديث للصفحة لا يصلح دليلاً على ما كان سيُرسَل.
 */
const STORAGE_KEY = "razeen_v2_staging_outbox";

function restore(): OutboundCall[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboundCall[]) : [];
  } catch { return []; }
}

export const outbox: OutboundCall[] = restore();

function persist(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(outbox)); } catch { /* تخزين غير متاح */ }
}

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

/** يشترك فيه صندوق الصادر ليُعيد الرسم عند تسجيل أي رسالة. */
export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const record = (entry: Omit<OutboundCall, "at">) => {
  outbox.push({ ...entry, at: Date.now() });
  persist();
  notify();
};

export const clearOutbox = () => { outbox.length = 0; persist(); notify(); };

const MODE: AdapterMode = "mock";
const inert = <T,>(data: T): AdapterResult<T> => ({ ok: true, data, inert: true });

/**
 * نتيجة الدفع في staging تُختار يدوياً — لازم يكون الطريقان (نجاح وفشل) قابلين
 * للاختبار. لا عشوائية: اختبار لا يمكن تكراره لا يثبت شيئاً.
 */
export type MockPaymentOutcome = "success" | "failure";
let paymentOutcome: MockPaymentOutcome = "success";
export const setMockPaymentOutcome = (outcome: MockPaymentOutcome) => { paymentOutcome = outcome; };
export const getMockPaymentOutcome = (): MockPaymentOutcome => paymentOutcome;

export const mockPaymentAdapter: PaymentAdapter = {
  mode: MODE,
  async createIntent({ orderNumber, amountFils }) {
    record({
      adapter: "payment", method: "createIntent", channel: "payment", to: orderNumber,
      payload: { orderNumber, amountFils },
      body: `تهيئة دفع تجريبي للطلب ${orderNumber} بمبلغ ${formatFils(amountFils)} — لم يُخصم شيء.`,
    });
    const intent: PaymentIntent = {
      id: `stg_intent_${orderNumber}`,
      // Deliberately not a provider URL — staging never leaves the app for payment.
      redirectUrl: `/staging/mock-payment?order=${encodeURIComponent(orderNumber)}`,
      amountFils,
      currency: "AED",
    };
    return inert(intent);
  },
  async verify(intentId) {
    const paid = paymentOutcome === "success";
    record({
      adapter: "payment", method: "verify", channel: "payment", to: intentId,
      payload: { intentId, outcome: paymentOutcome },
      body: `نتيجة تحقّق تجريبية: ${paid ? "نجح الدفع" : "فشل الدفع"} — لا حركة مالية حقيقية.`,
    });
    return inert({ paid, amountFils: 0 });
  },
};

export const mockMessagingAdapter: MessagingAdapter = {
  mode: MODE,
  async send({ to, body }) {
    record({ adapter: "messaging", method: "send", channel: "whatsapp", to, body, payload: { to, body } });
    return inert({ messageId: `stg_wa_${outbox.length}` });
  },
};

export const mockEmailAdapter: EmailAdapter = {
  mode: MODE,
  async send({ to, subject, body }) {
    record({ adapter: "email", method: "send", channel: "email", to, subject, body, payload: { to, subject, body } });
    return inert({ messageId: `stg_mail_${outbox.length}` });
  },
};

export const mockShippingAdapter: ShippingAdapter = {
  mode: MODE,
  async createShipment({ orderNumber, to }) {
    const trackingNumber = `STG-TRK-${orderNumber}`;
    record({
      adapter: "shipping", method: "createShipment", channel: "shipping", to: to.phone,
      payload: { orderNumber, to },
      body: `شحنة تجريبية للطلب ${orderNumber} باسم ${to.name} — رقم تتبّع ${trackingNumber}. لم تُنشأ شحنة حقيقية.`,
    });
    return inert({ trackingNumber });
  },
};

export const mockAnalyticsAdapter: AnalyticsAdapter = {
  mode: MODE,
  track(event, payload) {
    record({ adapter: "analytics", method: "track", channel: "analytics", to: "—", body: event, payload: { event, payload } });
  },
};
