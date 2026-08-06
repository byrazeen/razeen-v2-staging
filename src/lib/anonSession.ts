/**
 * جلسة مجهولة واحدة لكل متصفّح — one anonymous session per browser, ever.
 *
 * لماذا عادت المصادقة؟ لأن كل جدول في مسار الطلب صار مربوطاً بـ`auth.uid()`
 * في 0005، و`place_order` في 0007 مُصرَّح بها لـ`authenticated` وحدها. بلا
 * جلسة لا توجد سلة ولا طلب ولا حتى صف عميل — لا لأننا اخترنا ذلك في الواجهة،
 * بل لأن القاعدة نفسها ترفض.
 *
 * ولماذا `@supabase/auth-js` مباشرةً لا مظلّة `@supabase/supabase-js`؟ لنفس
 * السبب الذي حُذفت لأجله المظلّة أصلاً: المظلّة تجرّ realtime وstorage
 * وfunctions معها بلا سطر ينفّذها. المطلوب هنا شيء واحد — رمز وصول موقّع —
 * فيُطلب من الحزمة التي تصنعه وحدها.
 *
 * الشرط الذي لا يُساوَم عليه: **إعادة التحميل لا تُنشئ مستخدماً ثانياً**.
 *
 *   حساب مجهول جديد عند كل تحميل يعني سلةً تختفي، وطلباً لا يراه صاحبه بعد
 *   دقيقة، وجدول `auth.users` يمتلئ بأشباح. لذلك الترتيب هنا مقلوب عن البديهة:
 *   نسأل عن جلسة موجودة **أولاً**، ولا نوقّع دخولاً إلا حين يكون الجواب لا.
 *   والاستدعاءات المتزامنة تشترك في وعد واحد (`bootstrap`) كي لا يسبق نداءان
 *   بعضهما إلى `signInAnonymously` في نفس اللحظة.
 *
 * التخزين: `localStorage` تحت مفتاح معلن. وهذا الاستثناء الوحيد المقبول
 * لبقاء شيء في التخزين المحلي — الرمز نفسه، لا بيانات الطلب. حالة الطلب كلها
 * في القاعدة، والتخزين المحلي لا يحمل منها إلا نسخة عابرة للرسم الأول.
 */
import { GoTrueClient, type Session } from "@supabase/auth-js";
import { findViolations } from "@/config/envGuard";
import { stagingEnv, stagingHost } from "@/config/stagingEnv";

const supabaseUrl = stagingEnv.VITE_SUPABASE_URL;
const supabasePublishableKey = stagingEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

/** مفتاح تخزين الجلسة. معلن كي يُعرف ما الذي يُمسح عند مسحه. */
export const ANON_SESSION_STORAGE_KEY = "razeen_v2_staging_auth";

/** هل البيئة تحمل ما يكفي لجلسة؟ نفس شرط عميل PostgREST بالضبط. */
export const hasAnonSessionConfig = Boolean(supabaseUrl && supabasePublishableKey);

let auth: GoTrueClient | null = null;

/** آخر رمز وصول معروف. يُحدَّث عند كل تغيّر حالة — بما فيه التجديد التلقائي. */
let accessToken: string | null = null;

/** عدد مرات توقيع دخول مجهول جديد في هذه الصفحة. للتشخيص وللاختبار. */
let anonymousSignIns = 0;

function client(): GoTrueClient {
  if (!auth) {
    // نفس حارس عميل البيانات: لا اتصال ببيئة لم يُثبت أنها staging.
    const violations = findViolations({ env: stagingEnv, host: stagingHost });
    if (violations.length > 0) {
      throw new Error(
        "Refusing to start an auth client in an unverified environment:\n" +
          violations.map((v) => `  • ${v}`).join("\n")
      );
    }
    auth = new GoTrueClient({
      url: `${supabaseUrl!.replace(/\/+$/, "")}/auth/v1`,
      headers: { apikey: supabasePublishableKey!, "x-razeen-env": "staging" },
      storageKey: ANON_SESSION_STORAGE_KEY,
      // الثلاثة معاً هي «تبقى بعد التحديث»: تُحفظ، وتُقرأ من التخزين عند
      // الإقلاع، وتُجدَّد قبل انتهائها بدل أن تسقط الجلسة صامتةً.
      persistSession: true,
      autoRefreshToken: true,
      // لا رابط عودة ولا OAuth في هذه البيئة؛ قراءة الجزء من الرابط عبثٌ
      // وسطحُ هجوم صغير بلا مقابل.
      detectSessionInUrl: false,
      flowType: "implicit",
    });

    // الرمز يتغيّر بلا نداء منّا (التجديد التلقائي)، فيُقرأ من الحدث لا من
    // نسخة محفوظة وقت الإقلاع — وإلا لبقيت الطلبات تحمل رمزاً منتهياً.
    auth.onAuthStateChange((_event, session) => {
      accessToken = session?.access_token ?? null;
    });
  }
  return auth;
}

let bootstrap: Promise<Session | null> | null = null;

/**
 * الجلسة الحالية، وتُنشأ مجهولةً إن لم توجد. تُستدعى من أي مكان وبأي عدد:
 * النتيجة واحدة والوعد واحد.
 */
export function ensureAnonSession(): Promise<Session | null> {
  if (!hasAnonSessionConfig) return Promise.resolve(null);
  if (!bootstrap) {
    bootstrap = (async () => {
      const gotrue = client();

      // ١) الموجود أولاً. هذه السطور الثلاثة هي كل الفرق بين «مستخدم واحد
      //    للمتصفّح» و«مستخدم جديد لكل تحديث».
      const existing = await gotrue.getSession();
      if (existing.data.session) {
        accessToken = existing.data.session.access_token;
        return existing.data.session;
      }

      // ٢) ولا شيء غير ذلك يبرّر توقيع دخول جديد.
      //
      // بلا بوّابة بشرية — قرارٌ معلن لا سهو. الشرح الكامل في README تحت
      // «إساءة استعمال تسجيل الدخول المجهول»، وخلاصته هنا كي لا يُقرأ هذا
      // السطر يوماً على أنه نسيان:
      //
      //   * الخطر: هذا النداء يُنشئ صفاً في `auth.users` بلا أي إثبات، ويمكن
      //     تكراره بلا حدّ — ومعه سلة وبنود سلة، وربما `customers` و`orders`.
      //   * ما يحدّه اليوم: ٣٦ سياسة RESTRICTIVE تمنع كتابة السعر وحالة الدفع
      //     والمخزون والحالات، و`place_order` تُسعّر من القاعدة، ومفتاح
      //     idempotency يمنع التكرار، و`cleanup_stale_anonymous_users()` تكنس
      //     الراكد. وما لا يحدّه: عدد الحسابات نفسه — لا حدّ ولا تحدٍّ.
      //   * قبل أي إطلاق عام: يُفعَّل Turnstile من Supabase Auth ←
      //     Attack Protection، ويُمرَّر رمزه هنا:
      //         gotrue.signInAnonymously({ options: { captchaToken } })
      //     مع تحديد المعدّل على مستوى المشروع.
      //   * ولماذا مطفأ هنا: Turnstile يحمّل سكربتاً من طرف ثالث، وهذه البيئة
      //     تشترط صفر طلبات خارجية — ولا مال ولا عميل حقيقيين تحتهما تُبرَّر
      //     المقايضة (بيانات مصنَّعة، محوّلات وهمية، robots.txt يمنع الفهرسة).
      const created = await gotrue.signInAnonymously();
      if (created.error) throw created.error;
      anonymousSignIns += 1;
      accessToken = created.data.session?.access_token ?? null;
      return created.data.session ?? null;
    })().catch((error) => {
      // محاولة فاشلة لا تُجمّد التطبيق على وعد مرفوض إلى الأبد.
      bootstrap = null;
      throw error;
    });
  }
  return bootstrap;
}

/** الرمز الحالي إن وُجد. لا ينتظر: مسار القراءة العامة يعمل بلا جلسة. */
export function currentAccessToken(): string | null {
  return accessToken;
}

/** معرّف المستخدم المجهول الحالي — للتشخيص ولربط السلة. */
export async function currentUserId(): Promise<string | null> {
  const session = await ensureAnonSession();
  return session?.user?.id ?? null;
}

/** كم مرة وُقّع دخول مجهول جديد منذ تحميل الصفحة؟ يجب أن يكون 0 بعد التحديث. */
export function anonymousSignInCount(): number {
  return anonymousSignIns;
}
