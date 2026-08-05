/**
 * Adapter registry.
 *
 * Staging resolves to mocks and refuses to hand out a live adapter, so a stray
 * import cannot smuggle a real provider into a staging build. The check is here
 * rather than at each call site because call sites are the thing that gets
 * forgotten.
 */
import { findViolations } from "../config/envGuard";
import {
  mockAnalyticsAdapter, mockEmailAdapter, mockMessagingAdapter,
  mockPaymentAdapter, mockShippingAdapter,
} from "./mock";
import type { AnalyticsAdapter, EmailAdapter, MessagingAdapter, PaymentAdapter, ShippingAdapter } from "./types";

export interface Adapters {
  payment: PaymentAdapter;
  messaging: MessagingAdapter;
  email: EmailAdapter;
  shipping: ShippingAdapter;
  analytics: AnalyticsAdapter;
}

export function resolveAdapters(env: Record<string, string | undefined>, host?: string): Adapters {
  const violations = findViolations({ env, host });
  if (violations.length > 0) {
    throw new Error(
      "Refusing to resolve adapters in an unverified environment:\n" +
        violations.map((v) => `  • ${v}`).join("\n")
    );
  }
  return {
    payment: mockPaymentAdapter,
    messaging: mockMessagingAdapter,
    email: mockEmailAdapter,
    shipping: mockShippingAdapter,
    analytics: mockAnalyticsAdapter,
  };
}
