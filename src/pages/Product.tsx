/**
 * تفاصيل عطر جاهز — نهاية الرحلة الأولى: يعرف الاسم، يبحث، يضيف للسلة.
 *
 * الصورة أولاً وأكبر عنصر في الصفحة، ثم الاسم والسعر، ثم زر الشراء في متناول
 * الإبهام. الشحن مذكور هنا لا في آخر خطوة.
 *
 * وكانت الصفحة طريقاً مسدوداً: صفر روابط في متنها وصفر في الذيل. من وصل إليها
 * من البحث لا يملك إلا الإضافة للسلة أو زرّ الرجوع في المتصفّح. الآن: خيط عودة
 * إلى الرفّ فوق العنوان، وعطور أخرى تحته، ومسار العطر المخصص حين لا يُشترى هذا.
 * وما بين الزرّ وأسفل الصفحة — أربعمئة بكسل ورقٍ فارغ — صار الحقائق التي
 * يملكها الكتالوج أصلاً: العائلة والقوة والأسماء التي يُعرف بها.
 */
import { Link, useNavigate, useParams } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { useCart } from "@/lib/cart";
import { formatFils, readyMadePriceFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { familyLabel, intensityLabel } from "@/lib/productFacets";
import { Async, Empty } from "@/components/states";
import { Media } from "@/components/Media";
import { ProductCard } from "@/components/ProductCard";
import { BulkOfferLine } from "@/components/BulkNote";
import { Iso } from "@/components/text";

export default function Product() {
  const { handle } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const state = useAsync(() => repository.getProduct(handle ?? ""), [handle], { cacheKey: `product:${handle ?? ""}` });
  /** الرفّ نفسه — نفس المفتاح المحفوظ الذي تقرأه /ready و/search، بلا طلب زائد. */
  const shelf = useAsync(() => repository.listProducts(), [], { cacheKey: "products" });

  return (
    <Async
      state={state}
      empty={
        <Empty title="ما لقينا هذا المنتج" headingLevel={1}
          action={<Link className="btn ghost" to="/ready" style={{ maxWidth: 240, margin: "14px auto 0" }}>تصفّح المتوفر</Link>} />
      }
    >
      {(p) => {
        // السعر المخزَّن كما هو؛ لا سعر صالح ⇒ لا شراء ولا رقم بديل.
        const priceFils = readyMadePriceFils(p.priceFils);
        const buyable = p.is_available && priceFils !== null;
        const family = familyLabel(p.family);
        const intensity = intensityLabel(p.intensity);
        // أسماء لاتينية ضمن جملة عربية — تُعزَل اتجاهياً كبقية الواجهة.
        const aliases = (p.aliases ?? []).filter(Boolean);
        const related = (shelf.data ?? [])
          .filter((o) => o.handle !== p.handle && o.is_available && readyMadePriceFils(o.priceFils) !== null)
          .slice(0, 3);

        return (
          <>
            <Link to="/ready" className="crumb">كل العطور الجاهزة</Link>

            <div className="product">
              <div className="product-media">
                <Media label={p.title} />
                <p className="media-cap">صورة العطر تُضاف قبل الإطلاق</p>
              </div>

              <div className="product-info">
                <h1>{p.title}</h1>

                <div className="sum" style={{ borderTop: "1px solid var(--gold)", paddingTop: 14, marginTop: 8 }}>
                  <span>السعر</span>
                  {priceFils === null
                    ? <strong className="price-na" data-testid="product-price">{UNAVAILABLE_LABEL}</strong>
                    : <strong className="price price-lg" data-testid="product-price">{formatFils(priceFils)}</strong>}
                </div>

                <p style={{ margin: "10px 0 0" }}>
                  {priceFils === null || !p.is_available
                    ? <span className="tag danger">{UNAVAILABLE_LABEL}</span>
                    : <span className="tag ok">متوفر — {p.quantity} قطعة</span>}
                </p>

                {/* الشحن يُعرض هنا لا في آخر خطوة — المفاجأة السعرية سبب معروف لهجر السلة */}
                <p className="tiny muted" style={{ marginTop: 12 }}>
                  الشحن يُحتسب في السلة · التوصيل داخل الإمارات
                </p>

                {/* ما يعرفه الكتالوج عن العطر — لا وصفٌ مُخترع ولا نوتات لا نملكها. */}
                {(family || intensity || aliases.length > 0) && (
                  <>
                    <h2 className="eyebrow">عن هذا العطر</h2>
                    <dl className="facts">
                      {family && <div><dt>العائلة</dt><dd>{family}</dd></div>}
                      {intensity && <div><dt>القوة</dt><dd>{intensity}</dd></div>}
                      {aliases.length > 0 && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <dt>يُعرف أيضاً بـ</dt>
                          <dd>{aliases.map((a, i) => (
                            <span key={a}>{i > 0 && " · "}<Iso>{a}</Iso></span>
                          ))}</dd>
                        </div>
                      )}
                    </dl>
                  </>
                )}

                {buyable
                  ? <BulkOfferLine />
                  : (
                    <p className="tiny muted" style={{ marginTop: 14 }}>
                      تقدر تطلبه كعطر مخصص ونركّبه لك.{" "}
                      <Link className="crumb" to="/custom">صمّم عطرك الخاص</Link>
                    </p>
                  )}

                <div className="actionbar">
                  <button
                    className="btn" disabled={!buyable} data-testid="add-to-cart"
                    onClick={() => {
                      if (priceFils === null) return;
                      cart.add({ id: `ready:${p.handle}`, kind: "ready", title: p.title, unitPriceFils: priceFils });
                      navigate("/cart");
                    }}
                  >
                    {buyable ? "أضف للسلة" : UNAVAILABLE_LABEL}
                  </button>
                </div>
              </div>
            </div>

            {related.length > 0 && (
              <section className="product-tail">
                <h2 className="eyebrow">عطور أخرى على الرف</h2>
                <div className="shelf">
                  {related.map((o) => (
                    <ProductCard
                      key={o.handle} handle={o.handle} title={o.title}
                      priceFils={readyMadePriceFils(o.priceFils)}
                      family={o.family} intensity={o.intensity}
                      state={`متوفر — ${o.quantity} قطعة`}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        );
      }}
    </Async>
  );
}
