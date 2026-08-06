/** Ready-made shelf. Sold-out items are shown last and never look buyable. */
import { Link } from "react-router-dom";
import { repository } from "@/data/repository";
import { useAsync } from "@/lib/useAsync";
import { readyMadePriceFils, UNAVAILABLE_LABEL } from "@/lib/pricing";
import { Async, Empty } from "@/components/states";
import { ProductRow } from "@/components/ProductRow";

export default function Ready() {
  const state = useAsync(() => repository.listProducts(), []);

  return (
    <>
      <h1>العطور الجاهزة</h1>
      <p className="lede">ما هو على الرف الآن، بسعره كما هو. النافد يبقى ظاهراً ولا يُعرض للشراء.</p>

      <Async
        state={state}
        isEmpty={(list) => list.length === 0}
        empty={<Empty title="الرف فاضي حالياً" hint="جرّب العطر المخصص." headingLevel={2}
          action={<Link className="btn" to="/custom" style={{ maxWidth: 240, margin: "14px auto 0" }}>صمّم عطرك</Link>} />}
      >
        {(list) => {
          const sorted = [...list].sort((a, b) => Number(b.is_available) - Number(a.is_available));
          return (
            <>
              <h2 className="eyebrow">
                <span className="num">{list.filter((p) => p.is_available).length}</span> متوفر من{" "}
                <span className="num">{list.length}</span>
              </h2>
              <div className="grid list-2">
                {sorted.map((p) => {
                  // السعر المخزَّن وحده. بلا سعر صالح ⇒ غير متاح، بلا رقم مُخترع.
                  const priceFils = readyMadePriceFils(p.priceFils);
                  return (
                    <ProductRow
                      key={p.handle} handle={p.handle} title={p.title}
                      priceFils={priceFils}
                      dimmed={!p.is_available}
                      note={priceFils === null ? UNAVAILABLE_LABEL : p.is_available ? "متوفر الآن" : "نفد — لا يُعرض للشراء"}
                    />
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
