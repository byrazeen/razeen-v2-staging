/**
 * عزل الاتجاه — مكتوب مرة واحدة.
 *
 * النصّ اللاتيني أو الرقمي داخل فقرة عربية يخضع لخوارزمية bidi: المسافات بين
 * مقاطعه تُحسَب عربية، فتنقلب المقاطع. «0501234567@staging.invalid» كان يُعرض
 * «staging.invalid@0501234567»، و«STG-92862601» كان ينكسر عند الشرطة. الحلّ
 * هو عزل كل مقطع بـ<bdi> — لا تغيير في النصّ نفسه، عرضٌ فقط.
 */
import type { ReactNode } from "react";

/** مقطع معزول اتجاهياً. */
export function Iso({ children, className, nowrap }: { children: ReactNode; className?: string; nowrap?: boolean }) {
  return <bdi className={className} style={nowrap ? { whiteSpace: "nowrap" } : undefined}>{children}</bdi>;
}

/** رقم الطلب/التتبّع: معزول ولا ينكسر عند الشرطة. */
export function OrderNumber({ children }: { children: ReactNode }) {
  return <bdi className="num" style={{ whiteSpace: "nowrap" }}>{children}</bdi>;
}

/** STG-92862601 و STG-TRK-STG-92862601 وما شابههما. */
const ORDER_TOKEN = /(STG(?:-[A-Za-z0-9]+)+)/g;

/**
 * نصّ عربي فيه أرقام طلبات: كل رقم يُعزَل ويُمنع كسره، وبقية النصّ كما هو.
 * تُستعمل حيث تأتي الرسالة جاهزة من طبقة الطلبات ولا يمكن ترميزها في المصدر.
 */
export function ProseWithOrderNumbers({ text }: { text: string }) {
  const parts = text.split(ORDER_TOKEN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <OrderNumber key={i}>{part}</OrderNumber> : <span key={i}>{part}</span>
      )}
    </>
  );
}
