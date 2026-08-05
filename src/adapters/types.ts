/**
 * Ports for everything that reaches outside the app.
 *
 * The UI and the order logic depend on these interfaces only, never on Ziina,
 * WaSender, IQ or Meta directly. That is what lets staging run against mocks
 * and production against the real thing without either side knowing.
 */

export type AdapterMode = "mock" | "sandbox" | "disabled" | "live";

export interface AdapterResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** True when the adapter deliberately did nothing (staging). */
  inert?: boolean;
}

export interface PaymentIntent { id: string; redirectUrl: string; amountFils: number; currency: "AED"; }
export interface PaymentAdapter {
  readonly mode: AdapterMode;
  createIntent(input: { orderNumber: string; amountFils: number }): Promise<AdapterResult<PaymentIntent>>;
  verify(intentId: string): Promise<AdapterResult<{ paid: boolean; amountFils: number }>>;
}

export interface MessagingAdapter {
  readonly mode: AdapterMode;
  send(input: { to: string; body: string }): Promise<AdapterResult<{ messageId: string }>>;
}

export interface EmailAdapter {
  readonly mode: AdapterMode;
  send(input: { to: string; subject: string; body: string }): Promise<AdapterResult<{ messageId: string }>>;
}

export interface ShippingAdapter {
  readonly mode: AdapterMode;
  createShipment(input: { orderNumber: string; to: { name: string; phone: string; address: string } }): Promise<AdapterResult<{ trackingNumber: string }>>;
}

export interface AnalyticsAdapter {
  readonly mode: AdapterMode;
  track(event: string, payload?: Record<string, unknown>): void;
}
