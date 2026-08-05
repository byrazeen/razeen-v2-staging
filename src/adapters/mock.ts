/**
 * Staging implementations. They record what would have happened and return a
 * plausible shape, so the whole order journey is exercisable end to end without
 * a dirham moving or a customer being messaged.
 */
import type {
  AdapterMode, AdapterResult, AnalyticsAdapter, EmailAdapter,
  MessagingAdapter, PaymentAdapter, PaymentIntent, ShippingAdapter,
} from "./types";

export interface OutboundCall { adapter: string; method: string; payload: unknown; at: number; }

/** Everything staging *would* have sent. Read by tests and by the STAGING banner. */
export const outbox: OutboundCall[] = [];
const record = (adapter: string, method: string, payload: unknown) => {
  outbox.push({ adapter, method, payload, at: Date.now() });
};
export const clearOutbox = () => { outbox.length = 0; };

const MODE: AdapterMode = "mock";
const inert = <T,>(data: T): AdapterResult<T> => ({ ok: true, data, inert: true });

export const mockPaymentAdapter: PaymentAdapter = {
  mode: MODE,
  async createIntent({ orderNumber, amountFils }) {
    record("payment", "createIntent", { orderNumber, amountFils });
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
    record("payment", "verify", { intentId });
    return inert({ paid: true, amountFils: 0 });
  },
};

export const mockMessagingAdapter: MessagingAdapter = {
  mode: MODE,
  async send({ to, body }) {
    record("messaging", "send", { to, body });
    return inert({ messageId: `stg_wa_${outbox.length}` });
  },
};

export const mockEmailAdapter: EmailAdapter = {
  mode: MODE,
  async send({ to, subject, body }) {
    record("email", "send", { to, subject, body });
    return inert({ messageId: `stg_mail_${outbox.length}` });
  },
};

export const mockShippingAdapter: ShippingAdapter = {
  mode: MODE,
  async createShipment({ orderNumber, to }) {
    record("shipping", "createShipment", { orderNumber, to });
    return inert({ trackingNumber: `STG-TRK-${orderNumber}` });
  },
};

export const mockAnalyticsAdapter: AnalyticsAdapter = {
  mode: MODE,
  track(event, payload) { record("analytics", "track", { event, payload }); },
};
