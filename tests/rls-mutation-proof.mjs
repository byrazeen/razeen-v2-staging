/**
 * إثبات أن مجموعة RLS تقيس شيئاً.
 *
 * مجموعة اختبار خضراء لا تعني حماية سليمة — قد تعني أنها لا تفحص شيئاً. لذلك
 * نكسر الحماية عمداً ونشترط أن تحمرّ المجموعة، ثم نعيدها ونشترط أن تخضرّ.
 *
 * الطفرات مختارة لتصيب أخطر ثلاث ضمانات: عزل الطلبات بين العملاء، وحجب بيانات
 * العملاء عن الزائر، ومنع العميل من تعليم طلبه كمدفوع. لو مرّت أي منها خضراء،
 * فالسياسة المقابلة غير مُختبَرة فعلاً.
 */
import { spawnSync } from "node:child_process";

const MUTATIONS = [
  {
    name: "عزل الطلبات: أي عميل يرى كل الطلبات",
    sql: `drop policy if exists orders_select_own on public.orders;
          create policy orders_select_own on public.orders for select to authenticated using (true);`,
  },
  {
    name: "بيانات العملاء مكشوفة للزائر",
    sql: `create policy tmp_customers_anon on public.customers for select to anon using (true);`,
  },
  {
    name: "العميل يعدّل المدفوعات",
    sql: `create policy tmp_payments_write on public.payments for update to authenticated using (true) with check (true);`,
  },
  {
    // الطفرة التي تعيد الثغرة الحقيقية: إعادة منح تنفيذ دالة كتابة السجل.
    name: "سجل التدقيق قابل للتزوير من جديد",
    sql: `grant execute on function public.write_audit_log(text, text, uuid, jsonb, jsonb) to authenticated;`,
  },
];

const run = (env) =>
  spawnSync(process.execPath, ["tests/rls.test.mjs"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};

console.log("\n١) الحماية سليمة:");
const clean = run({});
console.log(`   خروج = ${clean.status} ${clean.status === 0 ? "(أخضر ✅)" : "(أحمر ❌)"}`);
check("المجموعة تنجح على السياسات الحقيقية", clean.status === 0);

console.log("\n٢) الحماية مكسورة عمداً — يجب أن تحمرّ:");
for (const m of MUTATIONS) {
  const mutated = run({ RLS_WEAKEN_SQL: m.sql });
  check(`${m.name} → خروج ${mutated.status}`, mutated.status !== 0);
}

console.log("\n٣) بلا طفرة من جديد:");
const restored = run({});
check("المجموعة تعود خضراء", restored.status === 0);

console.log(
  failures === 0
    ? "\n✅ مُثبَت: المجموعة تنجح مع الحماية وتفشل بدونها — فهي تقيس السياسات لا نصّها."
    : `\n❌ ${failures} مخالفة — طفرة لم تُكتشف تعني سياسة غير مُختبَرة.`
);
process.exit(failures === 0 ? 0 : 1);
