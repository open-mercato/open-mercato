# Fix CodeQL Insecure Randomness Alert

## Overview

Goal: clear CodeQL alert #134 by removing `Math.random()` from the password-adjacent entities integration fixture flow.

Scope:
- `packages/core/src/modules/entities/__integration__/TC-ENTITIES-007.spec.ts`
- Targeted validation for the touched test file/package

Non-goals:
- Broad cleanup of unrelated `Math.random()` call sites.
- Runtime behavior changes.
- API, schema, ACL, event, or import contract changes.

Existing specs checked:
- `.ai/specs/`
- `.ai/specs/enterprise/`

No existing spec directly covers this CodeQL remediation. This is a narrow security/test-helper fix, so no new architectural spec is needed.

## Implementation Plan

### Phase 1: Remediate Alert Source

1. Replace the test stamp suffix generated with `Math.random()` in `TC-ENTITIES-007.spec.ts` with a crypto-backed random value.
2. Run targeted static checks for remaining `Math.random()` usage in the touched file and a focused validation command for the affected package/test.
3. Run self-review against CodeQL intent and backward compatibility rules.

## Risks

- Low risk: the change only affects fixture uniqueness in one integration test.
- The random value remains non-user-facing test data, but CodeQL treats the flow as security-sensitive because it reaches login credentials.
- No tenant isolation, RBAC, DB schema, or public contract surfaces are changed.

## Validation Notes

- `rg "Math\.random\(" packages/core/src/modules/entities/__integration__/TC-ENTITIES-007.spec.ts packages/core/src/helpers/integration/api.ts -n` — no matches.
- `git diff --check` — passed.
- `yarn workspace @open-mercato/core typecheck` — failed before validation because the workspace script cannot resolve `tsc` directly.
- `yarn typecheck --filter=@open-mercato/core` — initially failed because generated `#generated/*` shims were missing in the clean worktree.
- `yarn build:packages` — passed.
- `yarn generate` — passed; emitted generated local artifacts and one non-fatal structural-cache warning.
- `yarn typecheck --filter=@open-mercato/core` — passed after generation.
- `yarn build:packages` (post-generate rebuild) — passed.
- `yarn i18n:check-sync` — passed.
- `yarn i18n:check-usage` — failed on 10 unrelated missing baseline keys in webhooks, scheduler, sso, integrations, inbox_ops, data_sync, and currencies pages; no changed files use translations.
- `yarn typecheck` — passed.
- `yarn test` — passed.
- `yarn build:app` — passed, with existing dynamic import/NFT tracing warnings.
- `yarn template:sync` — failed on unrelated existing template drift in the example module and dependency versions.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append `— <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remediate Alert Source

- [x] 1.1 Replace insecure test stamp randomness — c9b71a97a
- [x] 1.2 Validate affected test surface — c9b71a97a
- [x] 1.3 Complete self-review and BC review — c9b71a97a
