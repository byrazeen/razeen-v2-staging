/**
 * تصدير CSV يفتح في Excel بعربية سليمة.
 *
 * مسألتان تفسدان كل تصدير عربي رأيناه: غياب BOM فيقرأ Excel النص كـLatin-1
 * ويظهر «Ø¹Ø·Ø±», وعدم تهريب الفاصلة والاقتباس والسطر الجديد فتنزاح الأعمدة.
 * الاثنتان مُعالَجتان هنا، ومرة واحدة.
 */
import { EXPORT_COLUMNS } from "@/config/customOrderContract";
import type { Order } from "@/data/repository";

/** BOM لـUTF-8. بدونه يعرض Excel العربية مشوّهة. */
const BOM = "﻿";

/** قاعدة RFC 4180: اقتبس الحقل إن حوى فاصلة أو اقتباساً أو سطراً جديداً، وضاعف الاقتباس. */
export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: readonly string[]): string {
  const lines = [
    columns.map(escapeCsvField).join(","),
    ...rows.map((row) => columns.map((c) => escapeCsvField(row[c])).join(",")),
  ];
  return BOM + lines.join("\r\n") + "\r\n";
}

const formatAddress = (o: Order) =>
  [o.customer.address.emirate, o.customer.address.area, o.customer.address.street,
   o.customer.address.building, o.customer.address.flat].filter(Boolean).join(" · ");

/** سطر لكل صنف — كي يقرأ المشغل ما يصنعه دون فتح التطبيق. */
export function ordersToCsv(orders: Order[]): string {
  const rows = orders.flatMap((o) =>
    o.lines.map((l) => ({
      orderNumber: o.orderNumber,
      perfumeCode: l.perfumeCode ?? "",
      perfumeBrand: l.kind === "custom" ? l.title.split(" — ")[0] : "",
      perfumeName: l.title,
      size: l.size ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      customerNotes: l.subtitle ?? "",
      customerName: o.customer.name,
      customerPhone: o.customer.phone,
      customerAddress: formatAddress(o),
      paymentStatus: o.paymentStatus,
      productionStatus: o.productionStatus,
      shippingStatus: o.shippingStatus,
      createdAt: o.createdAt,
    }))
  );
  return toCsv(rows, EXPORT_COLUMNS);
}

/** تنزيل من المتصفح — بلا شبكة وبلا خدمة خارجية. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
