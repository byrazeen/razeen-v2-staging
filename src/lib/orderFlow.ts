/**
 * الطلب من السلة إلى الحالة النهائية، في مكان واحد.
 *
 * الترتيب مقصود: يُنشأ الطلب **غير مدفوع** أولاً، ثم يُحاول الدفع. إن فشل الدفع
 * يبقى الطلب غير مدفوع ولا يدخل قائمة التصنيع ولا تُرسَل له رسالة تأكيد دفع.
 * التدقيق وجد العكس في الإنتاج: طلبات دخلت التصنيع قبل أن يصل قرش.
 *
 * كل رسالة تمرّ عبر المحوّلات الوهمية فقط، فتُسجَّل في صندوق الصادر ولا تُرسَل.
 */
import { resolveAdapters } from "@/adapters";
import { stagingEnv, stagingHost } from "@/config/stagingEnv";
import type { StructuredAddress } from "@/config/customOrderContract";
import { repository, type Order, type OrderLine } from "@/data/repository";
import { buildOrderDraft } from "@/lib/orderDraft";
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
 * ينفّذ الطلب كاملاً. لا يرمي عند فشل الدفع — الفشل نتيجة صالحة يجب أن تُعرض.
 */
export async function placeOrder(lines: OrderLine[], customer: CheckoutCustomer): Promise<CheckoutResult> {
  // نفس الحساب الذي عُرض للعميل بالضبط — لا إعادة تسعير عند الإنشاء.
  const order = await repository.createOrder(buildOrderDraft(lines, customer));

  adapters.analytics.track("checkout_started", { orderNumber: order.orderNumber, totalFils: order.totalFils });

  // تأكيد استلام الطلب يُرسل دائماً — حتى لو فشل الدفع بعد قليل.
  await adapters.messaging.send({
    to: customer.phone,
    body:
      `مرحباً ${customer.name}، استلمنا طلبك ${order.orderNumber}.\n` +
      `الإجمالي ${money(order.totalFils)}.\n` +
      `الحالة: بانتظار الدفع.`,
  });

  const intent = await adapters.payment.createIntent({
    orderNumber: order.orderNumber,
    amountFils: order.totalFils,
  });
  if (!intent.ok || !intent.data) {
    return { order, paid: false, message: "تعذّرت تهيئة الدفع — الطلب محفوظ غير مدفوع." };
  }

  const verified = await adapters.payment.verify(intent.data.id);
  const paid = Boolean(verified.ok && verified.data?.paid);

  if (!paid) {
    // لا ترقية للحالة، ولا شحن، ولا دخول لقائمة التصنيع.
    const failed = await repository.setPaymentStatus(order.orderNumber, "failed");
    adapters.analytics.track("payment_failed", { orderNumber: order.orderNumber });
    await adapters.messaging.send({
      to: customer.phone,
      body: `تعذّر إتمام الدفع لطلب ${order.orderNumber}. الطلب محفوظ ولم يدخل التصنيع. تقدر تعيد المحاولة.`,
    });
    return { order: failed, paid: false, message: "فشل الدفع (تجريبي). الطلب باقٍ غير مدفوع ولن يدخل قائمة التصنيع." };
  }

  const paidOrder = await repository.setPaymentStatus(order.orderNumber, "paid");
  adapters.analytics.track("purchase", { orderNumber: order.orderNumber, totalFils: paidOrder.totalFils });

  await adapters.email.send({
    to: `${customer.phone}@staging.invalid`,
    subject: `إيصال الدفع — طلب ${paidOrder.orderNumber}`,
    body:
      `إيصال تجريبي.\nالطلب: ${paidOrder.orderNumber}\n` +
      paidOrder.lines.map((l) => `• ${l.title} ×${l.quantity} — ${money(lineTotalFils(l))}`).join("\n") +
      (paidOrder.discountFils > 0 ? `\nخصم الكمية: −${money(paidOrder.discountFils)}` : "") +
      `\nالشحن: ${paidOrder.shippingFils === 0 ? "مجاني" : money(paidOrder.shippingFils)}` +
      `\nالإجمالي: ${money(paidOrder.totalFils)}\n`,
  });

  await adapters.messaging.send({
    to: customer.phone,
    body: `تم استلام دفعتك لطلب ${paidOrder.orderNumber}. دخل الطلب قائمة التصنيع.`,
  });

  return { order: paidOrder, paid: true, message: "تم الدفع (تجريبي) ودخل الطلب قائمة التصنيع." };
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
