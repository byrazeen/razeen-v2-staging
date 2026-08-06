/**
 * طبقة الوصول للبيانات — الواجهة كلها تمر من هنا.
 *
 * الصفحات لا تعرف من أين تأتي البيانات: إن وُجد إعداد Supabase فمن Supabase،
 * وإلا فمن الذاكرة. الاختيار كله في `repositorySource.ts`، والعقد في
 * `repositoryContract.ts`، والتنفيذان في `memoryRepository.ts` و
 * `supabaseRepository.ts`. لا صفحة تغيّرت لأجل أيٍّ من ذلك.
 *
 * The pages depend on the `RazeenRepository` contract only. This module stays
 * their single import: it re-exports the contract and hands out whichever
 * implementation the environment selected.
 */
export type { Order, OrderDraft, OrderLine, RazeenRepository } from "@/data/repositoryContract";
export { isProductionEligible } from "@/data/repositoryContract";
export { mockRepository } from "@/data/memoryRepository";
export { repositorySource, type RepositorySource } from "@/data/repositorySource";

import type { RazeenRepository } from "@/data/repositoryContract";
import { activeRepository } from "@/data/repositorySource";

/** نقطة الوصول الوحيدة للصفحات. */
export const repository: RazeenRepository = activeRepository;
