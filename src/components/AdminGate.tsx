/**
 * بوّابة لوحة الإدارة — **تسجيل دخول وهمي في staging، وليست مصادقة**.
 *
 * لا كلمة سر حقيقية ولا مستخدم حقيقي ولا صلاحيات: مجرد مفتاح في
 * `sessionStorage` كي تُختبر شاشات الإدارة. المصادقة الحقيقية (Supabase Auth
 * وسياسات RLS) عمل لاحق، ومتروك عمداً غير مبدوء.
 *
 * MOCK SIGN-IN ONLY — NOT AUTHENTICATION. Never ship this gate anywhere real.
 */
import { useState, type ReactNode } from "react";

const KEY = "razeen_v2_staging_admin";
/** كلمة المرور معلنة على الشاشة نفسها — لأنها ليست سرّاً ولا تحمي شيئاً. */
const STAGING_CODE = "staging";

export const isAdminSignedIn = () =>
  typeof window !== "undefined" && window.sessionStorage.getItem(KEY) === "1";

export function AdminGate({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(isAdminSignedIn());
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (signedIn) {
    return (
      <>
        <div className="admin-bar">
          <span className="lat">STAGING ADMIN</span>
          <span>دخول وهمي بلا مصادقة حقيقية — mock sign-in, NOT real auth</span>
          <button className="spacer"
            onClick={() => { window.sessionStorage.removeItem(KEY); setSignedIn(false); }}>
            خروج
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <>
      <h1>دخول لوحة الإدارة</h1>
      <p className="placeholder-price">
        دخول وهمي لأغراض الاختبار فقط — لا يوجد مستخدمون ولا صلاحيات حقيقية.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim() !== STAGING_CODE) { setError("الرمز غير صحيح — الرمز هو staging"); return; }
          window.sessionStorage.setItem(KEY, "1");
          setSignedIn(true);
        }}
        className="form"
        style={{ marginTop: 16 }}
      >
        <label htmlFor="admin-code" className="small muted">رمز الدخول التجريبي (staging)</label>
        <input id="admin-code" className="field" value={code} onChange={(e) => setCode(e.target.value)} style={{ marginTop: 6 }} />
        {error && <p className="tiny" role="alert" style={{ color: "#991b1b" }}>{error}</p>}
        <button className="btn" style={{ marginTop: 12 }} type="submit">دخول</button>
      </form>
    </>
  );
}
