/**
 * صندوق الصادر — كل رسالة **كانت** ستُرسل، ولم تُرسل.
 *
 * تأكيد الطلب، إيصال الدفع، إشعار الشحن، ونداءات الدفع والقياس: كلها تُسجَّل من
 * المحوّلات الوهمية في `src/adapters/mock.ts`. لا واتساب ولا بريد ولا ناقل.
 * هذه الصفحة هي الدليل المقروء على أن staging لم يلمس أحداً.
 */
import { useSyncExternalStore } from "react";
import { outbox, subscribeOutbox, clearOutbox, type OutboundCall } from "@/adapters/mock";
import { Empty } from "@/components/states";
import { Iso, ProseWithOrderNumbers } from "@/components/text";
import { arabicCount, RECORD_FORMS } from "@/lib/arabic";

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "واتساب (وهمي)", email: "بريد (وهمي)", shipping: "شحن (وهمي)",
  payment: "دفع (وهمي)", analytics: "قياس (وهمي)",
};

const stamp = (at: number) => new Date(at).toLocaleString("ar-AE", { hour12: false });

export default function Outbox() {
  // القراءة من مصدر المحوّلات مباشرة: ما يُعرض هنا هو ما سُجِّل، لا نسخة عنه.
  const entries = useSyncExternalStore(subscribeOutbox, () => outbox.length);
  const list: OutboundCall[] = [...outbox].reverse();

  return (
    <>
      <h1>صندوق الصادر</h1>
      <p className="placeholder-price">
        لم تُرسَل أي رسالة — هذه سجلات فقط.{" "}
        <span dir="ltr" style={{ display: "inline-block" }}>Nothing here was ever sent.</span>
      </p>
      <h2 className="eyebrow"><span className="num">{arabicCount(entries, RECORD_FORMS)}</span></h2>

      {list.length === 0 ? (
        <Empty title="ما في رسائل بعد" hint="أكمل طلباً وسترى تأكيد الطلب وإيصال الدفع هنا." headingLevel={2} />
      ) : (
        <>
          <button className="chip" style={{ margin: "0 0 14px" }} onClick={clearOutbox}>تفريغ السجل</button>
          <div className="grid list-2">
            {list.map((e, i) => (
              <div key={`${e.at}-${i}`} className="card">
                <div className="row">
                  <strong className="small">{CHANNEL_LABEL[e.channel ?? ""] ?? e.adapter}</strong>
                  <span className="tiny muted num" style={{ marginInlineStart: "auto" }}>{stamp(e.at)}</span>
                </div>
                {/* «0501234567@staging.invalid» كان يُعرض «staging.invalid@0501234567». */}
                <span className="tiny muted" style={{ display: "block" }}>
                  إلى: <Iso className="num">{e.to ?? "—"}</Iso> · <Iso className="num">{`${e.adapter}.${e.method}`}</Iso>
                </span>
                {e.subject && <span className="small" style={{ display: "block", fontWeight: 700 }}><ProseWithOrderNumbers text={e.subject} /></span>}
                {e.body && <p className="small" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}><ProseWithOrderNumbers text={e.body} /></p>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
