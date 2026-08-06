/** Journey A — the customer who already knows the perfume. */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { search } from "@/lib/search";
import { readyMadePriceFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";
import { arabicCount, RESULT_FORMS } from "@/lib/arabic";
import { ProductRow } from "@/components/ProductRow";

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const state = useAsync(() => repository.listProducts(), []);
  const catalogue = state.data ?? [];
  // البحث يطابق العربي بعد التطبيع، ويقبل جزءاً من الاسم.
  const results = useMemo(() => (q.trim() ? search(q, catalogue) : []), [q, catalogue]);

  return (
    <>
      <h1>ابحث عن عطرك</h1>
      <p className="lede">اكتب ما تتذكّره — الاسم كاملاً أو جزءاً منه، بالعربي أو بالإنجليزي.</p>

      <label htmlFor="s" className="small muted" style={{ marginTop: 16 }}>اسم العطر أو البراند</label>
      <input
        id="s" className="field" autoFocus value={q}
        onChange={(e) => { setQ(e.target.value); setParams(e.target.value ? { q: e.target.value } : {}); }}
        placeholder="عود · مسك · ورد · citrus"
        style={{ marginTop: 6 }}
      />

      <div style={{ marginTop: 18 }}>
        <Async state={state}>
          {() =>
            !q.trim() ? (
              <Empty title="اكتب اسم العطر" hint="نفهم العربي والإنجليزي، وجزء الاسم يكفي." headingLevel={2} />
            ) : results.length === 0 ? (
              <Empty
                headingLevel={2}
                title="ما لقينا هذا العطر"
                hint="تقدر تطلبه كعطر مخصص ونركّبه لك."
                action={<Link to={`/custom?q=${encodeURIComponent(q)}`} className="btn" style={{ maxWidth: 260, margin: "14px auto 0" }}>اطلبه مخصصاً</Link>}
              />
            ) : (
              <>
                {/* عدد النتائج كان يتغيّر بصمت: لا live region في الصفحة إطلاقاً. */}
                <h2 className="eyebrow" style={{ marginTop: 0 }} role="status" aria-live="polite" aria-atomic="true">
                  <span className="num">{arabicCount(results.length, RESULT_FORMS)}</span>
                </h2>
                <div className="grid list-2">
                {results.map((p) => (
                  <ProductRow
                    key={p.handle} handle={p.handle} title={p.title}
                    priceFils={readyMadePriceFils(p.priceFils)}
                    note={p.is_available ? `متوفر — ${p.quantity} قطعة` : UNAVAILABLE_LABEL}
                  />
                ))}
                </div>
              </>
            )
          }
        </Async>
      </div>
    </>
  );
}
