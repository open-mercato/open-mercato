import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

// No features exist yet to grant (see acl.ts) — this stays empty until a
// real UI need adds some. Not dead boilerplate: `packages/core/AGENTS.md`'s
// own convention treats `acl.ts` and `setup.ts` as a paired contract, and
// every other minimal module in this codebase (`api_keys`, `auth`,
// `business_rules`, `entities`, `query_index`) ships a `setup.ts` alongside
// its `acl.ts` even when nearly empty.
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [],
  },
}

export default setup
