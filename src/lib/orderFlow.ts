/**
 * الطلب من السلة إلى الحالة النهائية، في مكان واحد.
 *
 * تغيّر الترتيب تغيّراً جوهرياً، ولسبب: كان الطلب يُبنى من المتصفّح في أربع
 * كتابات — طلب، ثم بنود، ثم دفعة، ثم طابور إنتاج — والمتصفّح هو من يرسل
 * `subtotal_fils` و`total_fils`. أي انقطاع بين كتابتين يترك طلباً بلا بنود،
 * وأي عميل يستطيع أن يرسل مجموعاً صفراً.
 *
 * الآن: **استدعاء واحد** لـ`place_order` في القاعدة. المتصفّح يرسل «ماذا»
 * — أي عطر، أي مقاس، كم — ولا يرسل «بكم». القاعدة تُسعّر، وتطبّق قاعدة
 * الثلاثة، وتكتب الطلب وبنوده ودفعته الوهمية ذرّياً، وتُدخل المدفوع وحده في
 * طابور الإنتاج. والمفتاح نفسه لا يُنشئ طلباً ثانياً أبداً.
 *
 * ومجاميع شاشة التأكيد هي مجاميع القاعدة العائدة، لا ما حسبته السلة. حساب
 * السلة يبقى للعرض — وهو غرضه المعلن في `@/lib/pricing`.
 *
 * كل رسالة تمرّ عبر المحوّلات الوهمية فقط، فتُسجَّل في صندوق الصادر ولا تُرسَل.
 */
import { resolveAdapters } from "@/adapters";
import { stagingEnv, stagingHost } from "@/config/stagingEnv";
import type { StructuredAddress } from "@/config/customOrderContract";
import { repository, type Order, type OrderLine } from "@/data/repository";
import type { PlaceOrderItem } from "@/data/repositoryContract";
import { formatFils, lineTotalFils } from "@/lib/pricing";

const adapters = resolveAdapters(stagingEnv, stagingHost);

export interface CheckoutCustomer {
  name: string;
  phone: string;
  address: StructuredAddress;
}

export interface CheckoutResult {
  order: Order;
  paid: boolean;
  /** سبب مقروء عند الفشل. */
  message: string;
}

const money = formatFils;

/**
 * مفتاح محاولة واحدة. يُولَّد مرة عند فتح شاشة الدفع ويُعاد استعماله عند إعادة
 * الإرسال — فالنقر مرتين، أو إعادة المحاولة بعد انقطاع، يُعيد الطلب نفسه.
 *
 * `crypto.randomUUID` حيث توجد، وإلا `crypto.getRandomValues` — ولا
 * `Math.random`: مفتاح قابل للتصادم يعني طلباً يُبتلع باسم «تكرار».
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * سطور السلة ⇒ بنود الطلب، **بلا سعر**. الحقول المرسَلة هي ما يعرّف الشيء
 * المطلوب وحده؛ أي مبلغ هنا كان سيُتجاهل في القاعدة على أي حال، ولا يُرسَل.
 */
export function itemsFromLines(lines: OrderLine[]): PlaceOrderItem[] {
  return lines.map((line) => {
    if (line.kind === "ready") {
      return { kind: "ready" as const, handle: line.id.replace(/^ready:/, ""), quantity: line.quantity };
    }
    return {
      kind: "custom" as const,
      catalogCode: line.perfumeCode,
      freeText: line.perfumeCode ? undefined : line.title,
      size: line.size,
      quantity: line.quantity,
      notes: line.subtitle,
    };
  });
}

/**
 * الهاتف بالشكل الذي تقبله القاعدة: `05XXXXXXXX`.
 *
 * النموذج يقبل «+971501234567» و«0501234567» و«501234567» لأن الثلاثة يكتبها
 * الناس فعلاً، و`customers.phone` يقبل واحداً منها فقط. التطبيع هنا لا في
 * الشاشة: مكان واحد يعني أن كل مسار يصل القاعدة بالشكل نفسه.
 */
export function normalizeUaePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "").replace(/^971/, "").replace(/^0+/, "");
  return `0${digits}`;
}

/**
 * ينفّذ الطلب كاملاً. لا يرمي عند فشل الدفع — الفشل نتيجة صالحة يجب أن تُعرض.
 *
 * @param idempotencyKey مفتاح المحاولة. تُمرّره الشاشة وتحتفظ به عبر إعادة
 *   الإرسال، فهو ما يجعل الإرسال المزدوج طلباً واحداً.
 */
export async function placeOrder(
  lines: OrderLine[],
  customer: CheckoutCustomer,
  idempotencyKey: string,
  outcome: "success" | "failed" = "success"
): Promise<CheckoutResult> {
  adapters.analytics.track("checkout_started", { itemCount: lines.length });

  const order = await repository.placeOrder({
    items: itemsFromLines(lines),
    customer: { ...customer, phone: normalizeUaePhone(customer.phone) },
    idempotencyKey,
    outcome,
  });

  const paid = order.paymentStatus === "paid";

  // تأكيد استلام الطلب يُرسل دائماً — بمجاميع القاعدة، لا بمجاميع الشاشة.
  await adapters.messaging.send({
    to: customer.phone,
    body:
      `مرحباً ${customer.name}، استلمنا طلبك ${order.orderNumber}.\n` +
      `الإجمالي ${money(order.totalFils)}.\n` +
      `الحالة: ${paid ? "مدفوع" : "بانتظار الدفع"}.`,
  });

  if (!paid) {
    adapters.analytics.track("payment_failed", { orderNumber: order.orderNumber });
    await adapters.messaging.send({
      to: customer.phone,
      body: `تعذّر إتمام الدفع لطلب ${order.orderNumber}. الطلب محفوظ ولم يدخل التصنيع. تقدر تعيد المحاولة.`,
    });
    return { order, paid: false, message: "فشل الدفع (تجريبي). الطلب باقٍ غير مدفوع ولن يدخل قائمة التصنيع." };
  }

  adapters.analytics.track("purchase", { orderNumber: order.orderNumber, totalFils: order.totalFils });

  await adapters.email.send({
    to: `${customer.phone}@staging.invalid`,
    subject: `إيصال الدفع — طلب ${order.orderNumber}`,
    body:
      `إيصال تجريبي.\nالطلب: ${order.orderNumber}\n` +
      order.lines.map((l) => `• ${l.title} ×${l.quantity} — ${money(lineTotalFils(l))}`).join("\n") +
      (order.discountFils > 0 ? `\nخصم الكمية: −${money(order.discountFils)}` : "") +
      `\nالشحن: ${order.shippingFils === 0 ? "مجاني" : money(order.shippingFils)}` +
      `\nالإجمالي: ${money(order.totalFils)}\n`,
  });

  await adapters.messaging.send({
    to: customer.phone,
    body: `تم استلام دفعتك لطلب ${order.orderNumber}. دخل الطلب قائمة التصنيع.`,
  });

  return { order, paid: true, message: "تم الدفع (تجريبي) ودخل الطلب قائمة التصنيع." };
}

/**
 * إشعار الشحن — يُطلق من لوحة الإدارة عند تسليم الطلب للناقل، ويسجَّل في الصادر.
 */
export async function notifyShipment(order: Order): Promise<string> {
  const shipment = await adapters.shipping.createShipment({
    orderNumber: order.orderNumber,
    to: {
      name: order.customer.name,
      phone: order.customer.phone,
      address: `${order.customer.address.emirate} · ${order.customer.address.area} · ${order.customer.address.street}`,
    },
  });
  const trackingNumber = shipment.data?.trackingNumber ?? `STG-TRK-${order.orderNumber}`;
  await adapters.messaging.send({
    to: order.customer.phone,
    body: `طلبك ${order.orderNumber} في الطريق. رقم التتبّع التجريبي: ${trackingNumber}.`,
  });
  return trackingNumber;
}
