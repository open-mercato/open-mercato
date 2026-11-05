// Canonical entity class lives in `../entities.ts` (single-file aggregate, same
// pattern as `packages/core/src/modules/customers/data/entities.ts`). This
// thin re-export exists so call sites that prefer the by-name import path
// (`.../entities/AiAgentRuntimeOverride`) keep working.

export { AiAgentRuntimeOverride } from '../entities'
export type { AiAgentRuntimeOverride as default } from '../entities'
