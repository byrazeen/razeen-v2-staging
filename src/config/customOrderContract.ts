/**
 * The one shape a custom order takes, from the customer's form to the admin
 * screen to the export. One contract because the audit found the same order
 * split across two tables joined by a text suffix, with fields the customer
 * typed never reaching the people who had to act on them.
 *
 * Rule: every field here must be readable by the customer, the admin and the
 * export without anyone re-typing it.
 */
export interface CustomOrderContract {
  orderNumber: string;
  perfumeName: string;
  perfumeBrand: string;
  /** Supplier oil code — the field the workshop actually orders by. */
  perfumeCode: string;
  size: "50ml" | "100ml" | "200ml";
  quantity: number;
  /** Server-computed. The number shown to the customer is the number charged. */
  unitPrice: number;
  currency: "AED";
  customerNotes: string | null;
  customer: { name: string; phone: string; address: StructuredAddress };
  paymentStatus: PaymentStatus;
  productionStatus: ProductionStatus;
  shippingStatus: ShippingStatus;
  createdAt: string;
}

/** Structured from the moment it is typed, so the carrier never needs it retyped. */
export interface StructuredAddress {
  emirate: string; area: string; street: string;
  building: string; flat?: string; notes?: string;
}

/** Three independent axes. The audit found one order carrying five conflicting vocabularies. */
export type PaymentStatus = "unpaid" | "paid" | "refunded" | "failed";
export type ProductionStatus = "not_started" | "queued" | "oil_ready" | "mixed" | "bottled" | "ready";
export type ShippingStatus = "not_shipped" | "handed_over" | "in_transit" | "delivered" | "returned";

/** Columns every export shares. Derived from the contract — never hand-edited. */
export const EXPORT_COLUMNS = [
  "orderNumber", "perfumeCode", "perfumeBrand", "perfumeName", "size", "quantity",
  "unitPrice", "customerNotes", "customerName", "customerPhone", "customerAddress",
  "paymentStatus", "productionStatus", "shippingStatus", "createdAt",
] as const;
