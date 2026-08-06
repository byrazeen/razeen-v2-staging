/**
 * جلسة الضيف — هوية المتسوّق بلا GoTrue وبلا إعداد في لوحة تحكّم.
 *
 * ما الذي تغيّر عن `anonSession` المحذوف؟ كل شيء في الطبقة، ولا شيء في الوعد:
 *
 *   قبل: `signInAnonymously()` يصنع صفاً في `auth.users`، ويعطي JWT، وRLS
 *        تقرأ `auth.uid()`. وهذا كان يشترط مفتاحاً يُقلَب في لوحة التحكّم —
 *        إعداد لا يظهر في هجرة ولا يفحصه اختبار.
 *   بعد: `issue_guest_token()` يصنع صفاً في `guest_sessions` (0009)، ويعيد
 *        رمزاً خاماً مرّة واحدة، وكل عملية تمرّ بدالة SECURITY DEFINER تتحقّق
 *        من الرمز بنفسها (0010). لا JWT، ولا GoTrue، ولا لوحة تحكّم.
 *
 * الشرط الذي لا يُساوَم عليه، وهو نفسه شرط الملف السابق حرفياً:
 * **إعادة التحميل لا تُصدر رمزاً ثانياً.** الترتيب مقلوب عن البديهة بقصد:
 * يُقرأ المخزَّن **أولاً**، ولا يُستدعى `issue_guest_token` إلا حين يكون
 * الجواب لا. والاستدعاءات المتزامنة تشترك في وعد واحد (`bootstrap`) كي لا
 * يسبق نداءان بعضهما إلى الإصدار في أول زيارة فتُولد جلستان.
 *
 * التخزين: `localStorage`، مفتاح واحد معلن، وقيمة واحدة — الرمز. ولا شيء آخر
 * يُعتدّ به: السلة والطلبات تُقرأ من الخادم في كل تحميل. الرمز الخام هنا هو
 * كل ما يملكه المتصفّح؛ القاعدة لا تخزّن إلا sha256 منه.
 *
 * والانتعاش من رمز ميّت مكتوب هنا مرّة واحدة (`withGuestToken`): إن ردّت
 * القاعدة `GUEST_TOKEN_UNKNOWN` أو `REVOKED` أو `EXPIRED`، يُرمى المخزَّن،
 * ويُصدَر رمز جديد، وتُعاد العملية **مرّة واحدة**. مرّة لا حلقة: رمزٌ جديد
 * يُرفض هو خلل في الخادم لا حالة يُعاد المحاولة فيها إلى الأبد.
 */
import { getSupabaseClient, hasSupabaseConfig } from "@/lib/supabaseClient";

/** مفتاح التخزين. معلن كي يُعرف ما الذي يُمسح عند مسحه. */
export const GUEST_TOKEN_STORAGE_KEY = "razeen_v2_staging_guest_token";

/** شكل الرمز كما تصنعه `issue_guest_token`: سابقة + ٦٤ محرفاً ست عشرياً. */
const TOKEN_SHAPE = /^rzn_guest_[0-9a-f]{64}$/;

/** الأخطاء الثلاثة التي تعني «الرمز لم يعد صالحاً» — وهي وحدها. */
const DEAD_TOKEN = /GUEST_TOKEN_(UNKNOWN|REVOKED|EXPIRED)/;

/** هل هذا الخطأ يعني رمزاً ميّتاً؟ يُقرأ من كل حقل قد يحمله PostgREST. */
export function isDeadGuestTokenError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { message?: string; details?: string; hint?: string; code?: string };
  return DEAD_TOKEN.test(`${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""} ${String(error)}`);
}

/** تعذّرت الجلسة أصلاً — تخزين محجوب أو بيئة بلا إعداد Supabase. */
export class GuestSessionUnavailableError extends Error {
  constructor(reason: string) {
    super(`تعذّرت جلسة الضيف: ${reason}`);
    this.name = "GuestSessionUnavailableError";
  }
}

/** عدد مرات إصدار رمز جديد منذ تحميل الصفحة. يجب أن يكون 0 بعد التحديث. */
let issuedCount = 0;
export const guestTokenIssueCount = (): number => issuedCount;

/** الرمز في الذاكرة — نسخة عن المخزَّن، لا مصدر مستقل. */
let cached: string | null = null;

export function readStoredGuestToken(): string | null {
  if (cached) return cached;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GUEST_TOKEN_STORAGE_KEY);
    // رمزٌ مشوّه في التخزين لا يُرسَل: القاعدة سترفضه بـUNKNOWN على أي حال،
    // ورفضُه هنا يوفّر جولة شبكة ويجعل السبب مقروءاً.
    if (raw && TOKEN_SHAPE.test(raw)) { cached = raw; return raw; }
  } catch { /* تخزين محجوب */ }
  return null;
}

function writeStoredGuestToken(token: string): void {
  cached = token;
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, token); } catch { /* تخزين محجوب */ }
}

/** يُرمى الرمز الميّت. لا يُمسح شيء غيره — لا سلة ولا طلبات، فليست هنا. */
export function clearGuestToken(): void {
  cached = null;
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(GUEST_TOKEN_STORAGE_KEY); } catch { /* تخزين محجوب */ }
}

/** الوعد المشترك. وجوده هو ما يمنع جلستين في أول زيارة. */
let bootstrap: Promise<string> | null = null;

async function issue(): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("issue_guest_token");
  if (error) throw new GuestSessionUnavailableError(error.message);
  const token = (data as { token?: string } | null)?.token;
  if (!token || !TOKEN_SHAPE.test(token)) {
    throw new GuestSessionUnavailableError("issue_guest_token لم يُعد رمزاً بالشكل المتوقّع");
  }
  issuedCount += 1;
  writeStoredGuestToken(token);
  return token;
}

/**
 * الرمز الحالي، ويُصدَر إن لم يوجد. تُستدعى من أي مكان وبأي عدد: الرمز واحد
 * والوعد واحد.
 */
export function ensureGuestToken(): Promise<string> {
  // ١) المخزَّن أولاً. هذا السطر هو كل الفرق بين «جلسة واحدة للمتصفّح»
  //    و«جلسة جديدة لكل تحديث».
  const stored = readStoredGuestToken();
  if (stored) return Promise.resolve(stored);

  if (!hasSupabaseConfig) {
    return Promise.reject(new GuestSessionUnavailableError("لا إعداد Supabase في هذه البيئة"));
  }

  // ٢) ولا شيء غير ذلك يبرّر إصداراً جديداً — ووعدٌ واحد لكل المستدعين.
  if (!bootstrap) {
    bootstrap = issue().catch((error) => {
      // محاولة فاشلة لا تُجمّد التطبيق على وعد مرفوض إلى الأبد.
      bootstrap = null;
      throw error;
    });
  }
  return bootstrap;
}

/**
 * تنفيذ عملية ضيف مع الانتعاش من رمز ميّت — **مرّة واحدة، لا حلقة**.
 *
 * كل عملية ضيف في طبقة البيانات تمرّ من هنا، فالمنطق مكتوب مرّة ويُختبر مرّة.
 */
export async function withGuestToken<T>(run: (token: string) => Promise<T>): Promise<T> {
  const token = await ensureGuestToken();
  try {
    return await run(token);
  } catch (error) {
    if (!isDeadGuestTokenError(error)) throw error;
    // الرمز ميّت: يُرمى، ويُصدَر بديل، وتُعاد المحاولة مرّة. ما يُرفض بعدها
    // يُرفع كما هو — المتسوّق يرى خطأً مفهوماً، ولا تدور الصفحة في حلقة.
    clearGuestToken();
    bootstrap = null;
    const fresh = await ensureGuestToken();
    return await run(fresh);
  }
}

/** إبطال الجلسة الحالية عمداً (للتشخيص وللاختبار). لا تستدعيها الشاشات. */
export async function revokeGuestSession(): Promise<void> {
  const token = readStoredGuestToken();
  clearGuestToken();
  bootstrap = null;
  if (!token || !hasSupabaseConfig) return;
  await getSupabaseClient().rpc("guest_revoke_token", { p_token: token });
}
