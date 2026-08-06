/**
 * اختيار مصدر البيانات — مكان واحد، مكتوب مرة واحدة.
 *
 * القاعدة كلها سطر واحد: إن وُجد إعداد Supabase كاملاً (رابط + مفتاح نشر) في
 * `import.meta.env` فالمصدر Supabase، وإلا فالذاكرة. لا شرط ثانٍ في أي ملف
 * آخر، ولا صفحة تسأل عن المصدر.
 *
 * The single, named place where the data source is decided. Supabase when the
 * environment carries both the URL and the publishable key; the in-memory
 * repository otherwise. No other file branches on this.
 */
import { mockRepository } from "@/data/memoryRepository";
import type { RazeenRepository } from "@/data/repositoryContract";
import { createSupabaseRepository } from "@/data/supabaseRepository";
import { getSupabaseClient, hasSupabaseConfig } from "@/lib/supabaseClient";

export type RepositorySource = "supabase" | "memory";

/** المصدر الفعّال، للعرض والتشخيص. */
export const repositorySource: RepositorySource = hasSupabaseConfig ? "supabase" : "memory";

export const activeRepository: RazeenRepository =
  repositorySource === "supabase"
    ? createSupabaseRepository({
        client: getSupabaseClient(),
        // مسار الطلب يحتاج `auth.uid()`، وتوفيره صار مسؤولية `anonSession`:
        // جلسة مجهولة دائمة تُنشأ مرة واحدة لكل متصفّح. هذا البديل لا يعمل إلا
        // حين تتعذّر تلك الجلسة أصلاً — وهي حالة معلنة لا الحالة العادية.
        sessionScopedFallback: mockRepository,
      })
    : mockRepository;
