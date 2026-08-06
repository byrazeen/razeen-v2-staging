/**
 * العميل الوحيد لـSupabase — a single PostgREST client for the whole app.
 *
 * لا مفتاح ولا رابط مكتوب هنا: القيم كلها من `import.meta.env` عبر
 * `stagingEnv`. ولا يُنشأ عميل إلا بعد أن يوافق الحارس على البيئة، فالاتصال
 * بمشروع غير مُثبت أنه staging ممنوع قبل أن يقع لا بعده.
 *
 * لماذا `@supabase/postgrest-js` مباشرةً بدل مظلّة `@supabase/supabase-js`؟
 * لأن التطبيق لا يستعمل من المظلّة إلا `.from()`. لا `channel(` ولا realtime
 * ولا storage ولا `functions.invoke` ولا `rpc(` في أي ملف تحت `src/`، ولا
 * تسجيل دخول في أي شاشة — فما من جلسة تُقرأ أصلاً. ومع ذلك كان استيراد
 * `createClient` يجرّ auth-js وrealtime-js وstorage-js وphoenix وfunctions-js
 * إلى الحزمة (~292 kB من 449 kB) بلا سطر واحد ينفّذها، ولا يقدر هزّ الشجرة
 * على إسقاطها لأنها كلها مركّبة داخل باني العميل. فالحلّ أن نطلب ما نستعمله.
 *
 * No URL and no key is written in this file. Every value comes from
 * `import.meta.env`. The client is created only after the environment guard
 * approves the environment, and a missing configuration throws a named error
 * instead of quietly building a client on `undefined`.
 */
import { PostgrestClient } from "@supabase/postgrest-js";
import { findViolations } from "@/config/envGuard";
import { stagingEnv, stagingHost } from "@/config/stagingEnv";

/** الرابط والمفتاح، كما وصلا من البيئة. لا قيمة افتراضية للمفتاح. */
const supabaseUrl = stagingEnv.VITE_SUPABASE_URL;
const supabasePublishableKey = stagingEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * مهلة كل طلب شبكة. الشبكة المعلّقة ليست حالة نجاح ولا حالة خطأ من تلقاء
 * نفسها: بلا مهلة تبقى الشاشة على هياكل التحميل إلى الأبد. عشر ثوانٍ تكفي
 * لأبطأ رفّ على 4G، وما بعدها يستحق «حاول مرة ثانية» لا انتظاراً صامتاً.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

export class SupabaseConfigError extends Error {
  constructor(missing: string[]) {
    super(
      "Supabase is not configured: " +
        missing.join(", ") +
        " missing from import.meta.env. Copy .env.example to .env.local and fill the staging values."
    );
    this.name = "SupabaseConfigError";
  }
}

/** أي متغيّر ناقص؟ يُستعمل للرسالة وللاختيار معاً. */
function missingConfig(): string[] {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabasePublishableKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}

/**
 * هل البيئة تحمل إعداد Supabase كاملاً؟ هذا وحده ما يقرّر مصدر البيانات.
 * True only when BOTH the URL and the publishable key are present.
 */
export const hasSupabaseConfig = missingConfig().length === 0;

/** نوع العميل الذي تعرفه بقية الطبقة — PostgREST وحده، بلا مظلّة. */
export type RazeenPostgrestClient = PostgrestClient;

let client: RazeenPostgrestClient | null = null;

/**
 * `fetch` بمهلة. الإجهاض حقيقي: الطلب المعلّق يُقطع فعلاً بدل أن يُترك مفتوحاً
 * وراء وعدٍ مرفوض. أي إشارة إجهاض قادمة من المُستدعي تُحترم كذلك.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AbortSignal as any).any?.([init.signal, timeout]) ?? timeout
    : timeout;
  return fetch(input, { ...init, signal });
}

/**
 * العميل المشترك. يرمي رسالة واضحة بدل أن يبني عميلاً على `undefined`.
 * Throws rather than constructing a client on undefined values.
 */
export function getSupabaseClient(): RazeenPostgrestClient {
  const missing = missingConfig();
  if (missing.length > 0) throw new SupabaseConfigError(missing);

  // نفس منطق سجلّ المحوّلات: لا اتصال من بيئة لم يُثبت أنها staging.
  const violations = findViolations({ env: stagingEnv, host: stagingHost });
  if (violations.length > 0) {
    throw new Error(
      "Refusing to create a Supabase client in an unverified environment:\n" +
        violations.map((v) => `  • ${v}`).join("\n")
    );
  }

  if (!client) {
    // نفس ما كانت المظلّة تبنيه: نقطة REST للمشروع، ومفتاح النشر في الترويستين
    // اللتين يقرأهما PostgREST — `apikey` للتوجيه و`Authorization` للدور anon.
    client = new PostgrestClient(`${supabaseUrl!.replace(/\/+$/, "")}/rest/v1`, {
      headers: {
        apikey: supabasePublishableKey!,
        Authorization: `Bearer ${supabasePublishableKey!}`,
        "x-razeen-env": "staging",
      },
      schema: "public",
      fetch: fetchWithTimeout,
    });
  }
  return client;
}
