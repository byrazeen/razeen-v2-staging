/** Journey A — the customer who already knows the perfume. */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { search } from "@/lib/search";
import { formatFils, readyMadePriceFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";

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
      <label htmlFor="s" className="small muted">اسم العطر أو البراند</label>
      <input
        id="s" className="field" autoFocus value={q}
        onChange={(e) => { setQ(e.target.value); setParams(e.target.value ? { q: e.target.value } : {}); }}
        placeholder="عود · مسك · ورد · citrus"
        style={{ marginTop: 6 }}
      />

      <div style={{ marginTop: 14 }}>
        <Async state={state}>
          {() =>
            !q.trim() ? (
              <Empty title="اكتب اسم العطر" hint="نفهم العربي والإنجليزي، وجزء الاسم يكفي." />
            ) : results.length === 0 ? (
              <Empty
                title="ما لقينا هذا العطر"
                hint="تقدر تطلبه كعطر مخصص."
                action={<Link to={`/custom?q=${encodeURIComponent(q)}`} className="btn" style={{ display: "inline-block", maxWidth: 260, marginTop: 12 }}>اطلبه مخصصاً</Link>}
              />
            ) : (
              <div className="grid">
                <p className="tiny muted">{results.length} نتيجة</p>
                {results.map((p) => {
                  const priceFils = readyMadePriceFils(p.priceFils);
                  return (
                    <Link key={p.handle} to={`/product/${p.handle}`} className="card row" style={{ justifyContent: "space-between" }}>
                      <span>
                        <strong>{p.title}</strong>
                        <span className="tiny muted" style={{ display: "block" }}>
                          {p.is_available ? `متوفر — ${p.quantity} قطعة` : UNAVAILABLE_LABEL}
                        </span>
                      </span>
                      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                        {priceFils === null ? UNAVAILABLE_LABEL : formatFils(priceFils)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )
          }
        </Async>
      </div>
    </>
  );
}
