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
      <h1>صندوق الصادر (staging)</h1>
      <p className="placeholder-price" style={{ display: "block" }}>
        ⚠️ لم تُرسَل أي رسالة. هذه سجلات فقط · nothing here was ever sent.
      </p>
      <p className="tiny muted">{entries} سجل</p>

      {list.length === 0 ? (
        <Empty title="ما في رسائل بعد" hint="أكمل طلباً وسترى تأكيد الطلب وإيصال الدفع هنا." />
      ) : (
        <>
          <button className="btn ghost" style={{ margin: "10px 0" }} onClick={clearOutbox}>تفريغ السجل</button>
          <div className="grid">
            {list.map((e, i) => (
              <div key={`${e.at}-${i}`} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong className="small">{CHANNEL_LABEL[e.channel ?? ""] ?? e.adapter}</strong>
                  <span className="tiny muted">{stamp(e.at)}</span>
                </div>
                <span className="tiny muted" style={{ display: "block" }}>إلى: {e.to ?? "—"} · {e.adapter}.{e.method}</span>
                {e.subject && <span className="small" style={{ display: "block", fontWeight: 700 }}>{e.subject}</span>}
                {e.body && <p className="small" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{e.body}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
