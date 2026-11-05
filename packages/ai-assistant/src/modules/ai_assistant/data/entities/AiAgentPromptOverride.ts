// Canonical entity class lives in `../entities.ts` (single-file aggregate, same
// pattern as `packages/core/src/modules/customers/data/entities.ts`). This
// thin re-export exists so call sites that prefer the by-name import path
// (`.../entities/AiAgentPromptOverride`) keep working.

export { AiAgentPromptOverride } from '../entities'
export type { AiAgentPromptOverride as default } from '../entities'
