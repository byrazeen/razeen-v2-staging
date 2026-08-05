/**
 * قراءة واحدة من طبقة البيانات مع الحالات الثلاث: تحميل، خطأ، بيانات.
 * كل سطح بيانات في التطبيق يمر من هنا كي لا تخترع كل صفحة حالاتها.
 */
import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // القارئ ثابت بين إعادات الرسم إلا إذا تغيّرت الاعتماديات المعلنة في الصفحة.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    run()
      .then((value) => { if (alive) { setData(value); setLoading(false); } })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "خطأ غير معروف");
        setLoading(false);
      });
    return () => { alive = false; };
  }, [run, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
