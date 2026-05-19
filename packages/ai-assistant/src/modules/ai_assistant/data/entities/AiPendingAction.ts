// Canonical entity class lives in `../entities.ts` (single-file aggregate, same
// pattern as `packages/core/src/modules/customers/data/entities.ts`). This
// thin re-export exists so call sites that prefer the by-name import path
// (`.../entities/AiPendingAction`) keep working.

export { AiPendingAction } from '../entities'
export type { AiPendingAction as default } from '../entities'
