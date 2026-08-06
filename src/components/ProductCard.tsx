/**
 * بطاقة العطر — الوحدة الوحيدة لعرض عطر على أي سطح تصفّح.
 *
 * كانت القوائم تعرض إطار صورة بعرض 64 بكسل: الصورة «البطل» بحجم أيقونة، والسعر
 * في الطرف الآخر من سطر عرضه نصف الشاشة. هنا اللوحة الحبرية بنسبة 4:5 — نفس
 * لوحة صفحة العطر — تقود، والاسم والسعر يُصفّان تحتها. لا صندوق أبيض حولها:
 * اللوحة نفسها هي الجسم، والورق يبقى ورقاً.
 *
 * الترتيب تحت اللوحة: الاسم، ثم خيط ذهبي، ثم السعر وحالة التوفر في سطر واحد.
 * الخيط الذهبي هو نفسه الذي يفصل عنوان صفحة العطر عن سعره — أثر واحد متكرّر.
 */
import { Link } from "react-router-dom";
import { formatFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { facetLine } from "@/lib/productFacets";
import { Media } from "./Media";

export function ProductCard({
  handle, title, priceFils, state, family, intensity, imageSrc, dimmed,
}: {
  handle: string;
  title: string;
  /** السعر كما تعطيه وحدة التسعير. `null` = غير قابل للشراء. */
  priceFils: number | null;
  /** حالة التوفر بكلمة واحدة — تحت السعر لا فوقه. */
  state: string;
  family?: string | null;
  intensity?: number | null;
  /** يوم تصل صور المنتجات: مرّرها هنا ويختفي البديل. */
  imageSrc?: string;
  /** نفد من المخزون: يُخفَّض بصرياً ويبقى مقروءاً. */
  dimmed?: boolean;
}) {
  const unavailable = priceFils === null;
  const facets = facetLine(family, intensity);
  return (
    <Link
      to={`/product/${handle}`}
      className={`shelf-card ${unavailable || dimmed ? "sold-out" : ""}`.trim()}
    >
      <Media label={title} src={imageSrc} />
      <span className="shelf-body">
        <strong className="shelf-name">{title}</strong>
        {facets && <span className="shelf-facets">{facets}</span>}
        <span className="shelf-foot">
          <span className={unavailable ? "price-na" : "price"}>
            {unavailable ? UNAVAILABLE_LABEL : formatFils(priceFils)}
          </span>
          <span className="shelf-state">{state}</span>
        </span>
      </span>
    </Link>
  );
}
