/**
 * The guard runs before React mounts. If this environment cannot prove it is
 * staging, the app renders the reason instead of the store — a halt someone
 * reads, rather than a silent boot against production.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { findViolations } from "./config/envGuard";
import { stagingEnv, stagingHost } from "./config/stagingEnv";
import { ensureGuestToken } from "./lib/guestSession";
import "./styles.css";

const violations = findViolations({ env: stagingEnv, host: stagingHost });

const root = createRoot(document.getElementById("root")!);

if (violations.length > 0) {
  root.render(
    <div dir="rtl" style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ color: "#991b1b" }}>توقّف: بيئة غير آمنة</h1>
      <p>هذه نسخة STAGING ورفضت الإقلاع لأنها اكتشفت أثراً للإنتاج أو تكويناً ناقصاً:</p>
      <ul>{violations.map((v) => <li key={v} style={{ marginBottom: 6 }}><code>{v}</code></li>)}</ul>
      <p style={{ marginTop: 16 }}><strong>RAZEEN V2 STAGING must never connect to RAZEEN Production resources.</strong></p>
    </div>
  );
} else {
  // جلسة الضيف تُهيَّأ بعد الحارس ومرة واحدة: يُقرأ الرمز المخزَّن إن وُجد،
  // ولا يُصدَر رمز جديد إلا حين لا يوجد. الاستدعاءات اللاحقة كلها تشترك في
  // الوعد نفسه، فتحديث الصفحة لا يُصدر جلسة ثانية. الفشل لا يمنع الإقلاع:
  // الرفّ العام مقروء بلا جلسة، ومسار الطلب يعلن تعذّره حين يُطلب.
  ensureGuestToken().catch((error) => { console.error("guest session bootstrap failed", error); });
  root.render(<StrictMode><App /></StrictMode>);
}
