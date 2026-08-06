/**
 * سطر عطر في القوائم — نفس الشكل في البحث والرف والترشيحات، كي لا يتعلّم العميل
 * ثلاث قراءات لنفس المعلومة.
 *
 * الترتيب مقصود: الصورة أولاً (هي البطل)، ثم الاسم، ثم حالة التوفر، والسعر في
 * الطرف حيث تصل إليه العين آخراً. العرض فقط — لا حساب هنا ولا في أي صفحة.
 */
import { Link } from "react-router-dom";
import { formatFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { Media } from "./Media";

export function ProductRow({
  handle, title, priceFils, note, imageSrc, dimmed,
}: {
  handle: string;
  title: string;
  /** السعر كما تعطيه وحدة التسعير. `null` = غير قابل للشراء. */
  priceFils: number | null;
  note: string;
  /** يوم تصل صور المنتجات: مرّرها هنا ويختفي البديل. */
  imageSrc?: string;
  /** نفد من المخزون: يُخفَّض بصرياً ويبقى مقروءاً. */
  dimmed?: boolean;
}) {
  const unavailable = priceFils === null;
  return (
    <Link to={`/product/${handle}`} className={`card row ${unavailable || dimmed ? "sold-out" : ""}`.trim()}
      style={{ display: "flex", gap: 14 }}>
      <Media size="thumb" label={title} src={imageSrc} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: "block", lineHeight: 1.5 }}>{title}</strong>
        <span className="tiny muted" style={{ display: "block" }}>{note}</span>
      </span>
      <span className={unavailable ? "price-na" : "price"} style={{ textAlign: "end" }}>
        {unavailable ? UNAVAILABLE_LABEL : formatFils(priceFils)}
      </span>
    </Link>
  );
}
