/** Ready-made shelf. Sold-out items are shown last and never look buyable. */
import { Link } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { formatFils, readyMadePriceFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";

export default function Ready() {
  const state = useAsync(() => repository.listProducts(), []);

  return (
    <>
      <h1>العطور الجاهزة</h1>
      <Async
        state={state}
        isEmpty={(list) => list.length === 0}
        empty={<Empty title="الرف فاضي حالياً" hint="جرّب العطر المخصص."
          action={<Link className="btn" to="/custom" style={{ display: "inline-block", maxWidth: 240, marginTop: 12 }}>صمّم عطرك</Link>} />}
      >
        {(list) => {
          const sorted = [...list].sort((a, b) => Number(b.is_available) - Number(a.is_available));
          return (
            <>
              <p className="tiny muted">{list.filter((p) => p.is_available).length} متوفر من {list.length}</p>
              <div className="grid" style={{ marginTop: 12 }}>
                {sorted.map((p) => {
                  // السعر المخزَّن وحده. بلا سعر صالح ⇒ غير متاح، بلا رقم مُخترع.
                  const priceFils = readyMadePriceFils(p.priceFils);
                  const buyable = p.is_available && priceFils !== null;
                  return (
                    <Link key={p.handle} to={`/product/${p.handle}`} className="card row" style={{ justifyContent: "space-between", opacity: buyable ? 1 : 0.55 }}>
                      <span>
                        <strong>{p.title}</strong>
                        <span className="tiny muted" style={{ display: "block" }}>
                          {priceFils === null ? UNAVAILABLE_LABEL : p.is_available ? "متوفر" : "نفد — لا يُعرض للشراء"}
                        </span>
                      </span>
                      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                        {priceFils === null ? UNAVAILABLE_LABEL : formatFils(priceFils)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
