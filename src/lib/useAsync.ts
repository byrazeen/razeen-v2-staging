/**
 * قراءة واحدة من طبقة البيانات مع الحالات الثلاث: تحميل، خطأ، بيانات.
 * كل سطح بيانات في التطبيق يمر من هنا كي لا تخترع كل صفحة حالاتها.
 *
 * ثلاثة أشياء مقيسة تُحسم هنا لأن مكانها واحد:
 *
 *  1. المهلة. الشبكة المعلّقة كانت تُبقي `/ready` على هياكل التحميل أكثر من
 *     ثلاثين ثانية بلا نهاية — بينما الفشل الحاسم يصل لحالة الخطأ فوراً. أي
 *     قراءة تتجاوز `READ_TIMEOUT_MS` تصير خطأً بزرّ إعادة محاولة.
 *
 *  2. الرسالة. نصّ الاستثناء لا يصل إلى العميل أبداً: «TypeError: Failed to
 *     fetch» و«Supabase products» ليستا عربيتين ولا مفهومتين وتكشفان المزوّد
 *     واسم الجدول. التفصيل التقني يذهب إلى `console.error` وحده.
 *
 *  3. الذاكرة. `<main key={pathname}>` يعيد بناء كل شاشة عند كل انتقال، و
 *     StrictMode يُركّب مرتين: فكانت زيارة الرفّ الواحدة تطلب `products`
 *     مرتين، والرجوع من العطر إلى الرفّ يعيد جلب الفهرس كله ويعيد إظهار
 *     الهيكل. مفتاح ذاكرة اختياري يوحّد الطلبات الجارية ويحفظ آخر قيمة: طلب
 *     واحد لكل قراءة، ولا طلب أصلاً عند الرجوع.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** مهلة أي قراءة. ما بعدها انتظارٌ صامت لا يخدم أحداً. */
export const READ_TIMEOUT_MS = 10_000;

/** ما يراه العميل حين تفشل القراءة، أياً كان سبب الفشل التقني. */
export const READ_ERROR_MESSAGE = "تعذّر تحميل العطور. تأكد من اتصالك وحاول مرة ثانية.";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  /** رسالة للعميل — عربية ومفهومة. لا نصّ استثناء ولا اسم جدول. */
  error: string | null;
  reload: () => void;
}

export interface AsyncOptions {
  /**
   * مفتاح الذاكرة. القراءات العامة (الرفّ، الفهرس، صفحة العطر) تشترك فيه
   * فلا تتكرّر. القراءات التي تتغيّر بالكتابة تُترك بلا مفتاح عمداً.
   */
  cacheKey?: string;
  /** رسالة العميل عند الفشل، إن كانت الشاشة تستحق نصّاً أخصّ. */
  errorMessage?: string;
}

/** آخر قيمة ناجحة لكل مفتاح، وطلباتٌ جارية كي لا يخرج نفس الطلب مرتين. */
const cachedValues = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

/** إسقاط ما حُفظ — للمفتاح الواحد أو للذاكرة كلها. */
export function invalidateAsyncCache(cacheKey?: string): void {
  if (cacheKey === undefined) {
    cachedValues.clear();
    inflight.clear();
    return;
  }
  cachedValues.delete(cacheKey);
  inflight.delete(cacheKey);
}

/** الوعد المعلّق يصير خطأً بدل أن يبقى معلّقاً إلى الأبد. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Read timed out after ${READ_TIMEOUT_MS}ms`)),
      READ_TIMEOUT_MS
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[] = [],
  options: AsyncOptions = {}
): AsyncState<T> {
  const { cacheKey, errorMessage = READ_ERROR_MESSAGE } = options;

  // البداية من الذاكرة إن وُجدت: الرجوع للخلف يعرض الرفّ فوراً بلا هيكل تحميل.
  const cached = cacheKey !== undefined && cachedValues.has(cacheKey)
    ? (cachedValues.get(cacheKey) as T)
    : undefined;

  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const messageRef = useRef(errorMessage);
  messageRef.current = errorMessage;

  // القارئ ثابت بين إعادات الرسم إلا إذا تغيّرت الاعتماديات المعلنة في الصفحة.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let alive = true;

    // قيمة محفوظة ⇒ لا طلب أصلاً. هذا ما يجعل الرجوع فورياً.
    if (cacheKey !== undefined && cachedValues.has(cacheKey)) {
      setData(cachedValues.get(cacheKey) as T);
      setLoading(false);
      setError(null);
      return () => { alive = false; };
    }

    setLoading(true);
    setError(null);

    // طلب جارٍ بنفس المفتاح ⇒ نشترك فيه. التركيب المزدوج لا يضاعف الشبكة.
    let promise: Promise<T>;
    if (cacheKey !== undefined && inflight.has(cacheKey)) {
      promise = inflight.get(cacheKey) as Promise<T>;
    } else {
      promise = withTimeout(run());
      if (cacheKey !== undefined) {
        const key = cacheKey;
        const started = promise;
        inflight.set(key, started);
        started
          .then((value) => { cachedValues.set(key, value); })
          .catch(() => { /* الفشل لا يُحفظ: المحاولة التالية تطلب من جديد */ })
          .finally(() => { if (inflight.get(key) === started) inflight.delete(key); });
      }
    }

    promise
      .then((value) => { if (alive) { setData(value); setLoading(false); } })
      .catch((e: unknown) => {
        if (!alive) return;
        // التفصيل التقني للمطوّر في الطرفية، لا للعميل على الشاشة.
        console.error("useAsync read failed", e);
        setError(messageRef.current);
        setLoading(false);
      });

    return () => { alive = false; };
  }, [run, nonce, cacheKey]);

  const reload = useCallback(() => {
    if (cacheKey !== undefined) invalidateAsyncCache(cacheKey);
    setNonce((n) => n + 1);
  }, [cacheKey]);

  return { data, loading, error, reload };
}
