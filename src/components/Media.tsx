/**
 * إطار صورة المنتج — المكان الوحيد الذي تُعرض فيه صورة عطر.
 *
 * لا توجد صور حقيقية في هذه البيئة (البذرة بلا تصوير)، فيُرسم بديل مقصود:
 * قارورة مرسومة بخيط ذهبي رفيع داخل خزانة حبرية. البديل ليس مربّعاً مكسوراً
 * ولا أيقونة «صورة مفقودة» — هو جزء من الهوية ويبدو مقصوداً بذاته.
 *
 * يوم تصل الصور: مرّر `src` (و`alt`) فقط. الوسم لا يتغيّر في أي صفحة، والصورة
 * تغطّي البديل بالكامل. هذا كل ما يلزم للتبديل.
 */

/** القارورة — مرسومة يدوياً، بلا حزمة أيقونات وبلا ملف خارجي. */
export function Flacon({ className = "" }: { className?: string }) {
  return (
    <svg className={`flacon ${className}`.trim()} viewBox="0 0 100 140" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="40" y="5" width="20" height="17" rx="3" />
      <path d="M45 22h10v11H45z" />
      <path d="M31 33h38c8 0 13 6 13 15v67c0 8-5 13-13 13H31c-8 0-13-5-13-13V48c0-9 5-15 13-15z" />
      <path d="M18 60h64" opacity=".5" />
      <path d="M34 78h32v26H34z" opacity=".65" />
    </svg>
  );
}

export function Media({
  src, alt, label, size = "full", className = "",
}: {
  src?: string;
  alt?: string;
  /** يُنطق للقارئ الصوتي حين لا توجد صورة. */
  label?: string;
  size?: "full" | "thumb";
  className?: string;
}) {
  return (
    <div
      className={`media ${size === "thumb" ? "thumb" : ""} ${className}`.trim()}
      role="img"
      aria-label={alt ?? (label ? `${label} — لا توجد صورة بعد` : "لا توجد صورة بعد")}
    >
      <Flacon />
      {src && <img src={src} alt={alt ?? label ?? ""} loading="lazy" />}
    </div>
  );
}
