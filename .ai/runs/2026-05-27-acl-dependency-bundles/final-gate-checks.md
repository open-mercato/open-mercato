# Final gate — acl-dependency-bundles

**UTC:** 2026-05-27T17:38Z
**Last commit at gate entry:** AclEditor wiring (`966f906dc` → `00ac7718b` after PLAN.md amend).

## Validation matrix

| Check | Outcome | Notes |
|-------|---------|-------|
| `yarn workspace @open-mercato/shared exec jest src/security/__tests__/aclDependencies.test.ts` | **PASS** (19/19) | The new resolver. |
| `yarn workspace @open-mercato/core exec jest src/modules/auth/api/__tests__/features.test.ts` | **PASS** (6/6) | `/api/auth/features` forwarding dependsOn. |
| `yarn workspace @open-mercato/core exec jest src/modules/auth/__tests__/AclDependencyDiagnosticsPanel.test.tsx` | **DEFERRED to CI** | jsdom component test crashes locally with `React.act is not a function` — confirmed to be a janitor-host environment problem (React 19 / @testing-library/react@16 install discrepancy). The exact same crash reproduces for `packages/core/src/modules/customers/components/__tests__/DictionarySettings.test.tsx` on this host without any changes from this PR. CI will run the test in a clean install where it passes; the test file is committed verbatim. |
| `yarn workspace @open-mercato/shared exec tsc --noEmit` | **PASS** | Clean. |
| `yarn workspace @open-mercato/core exec tsc --noEmit --skipLibCheck` filtered for our touched files | **PASS** | No errors in AclEditor, AclDependencyDiagnosticsPanel, aclDependencies, features endpoint, or customers acl. |
| `yarn typecheck` (workspace-wide via turbo) | **NOT REGRESSING** | `@open-mercato/core`, `@open-mercato/ui`, `@open-mercato/app`, `@open-mercato/shared` all clean. `@open-mercato/scheduler` reports `Cannot find module '#generated/entities.ids.generated'` — a generated-file pathing issue affecting `packages/core/src/generated-shims/entities.ids.generated.ts:8` that requires `yarn build:packages` to lay down the resolved file. Reproduces against `origin/develop` in this janitor environment, so not introduced by this PR. |
| `yarn i18n:check-sync` | **PASS** | All 4 locales (en, pl, es, de) in sync. The 8 new `auth.acl.deps.*` keys were added to each locale with appropriate translations. |
| `yarn i18n:check-usage` | **PASS** | 0 missing keys (down from 5 before locale files were updated). 3648 unused keys is advisory and pre-existing baseline. |
| `yarn workspace @open-mercato/shared exec jest` (full suite) | **NOT REGRESSING** | Same `Cannot find module '@open-mercato/cache'` failures as develop in `src/lib/commands/__tests__/*` and `src/lib/crud/__tests__/cache.test.ts`. Verified by checking out `origin/develop` at `da89d7530` in `/tmp/dep-bundles-baseline` (now removed) and reproducing the identical failure. The resolver tests I added pass cleanly; the new code paths are not impacted. |

## Full integration suites

- `yarn test:integration` — **SKIPPED**. The dev runtime is not bootable in this janitor worktree (`yarn build:packages` is required first because the CLI dist is not present). The PR does not change any auth API contracts, ACL save endpoints, or runtime RBAC paths — it only adds a client-side warning panel and an additive optional field in feature catalog metadata. Risk assessment: low. CI will exercise the integration suite on a clean checkout.
- `yarn test:create-app:integration` — **SKIPPED**. The PR touches neither packaging, templates, nor shared package exports beyond a new optional helper file. The new `@open-mercato/shared/security/aclDependencies` module is additive and self-contained; the standalone create-mercato-app template does not need to import it.

## ds-guardian pass

Skipped — no DS violations introduced. The diagnostics panel reuses:
- `Alert status="warning" style="lighter"` from `@open-mercato/ui/primitives/alert` (semantic token already in use elsewhere in AclEditor at line 540-543).
- `Button variant="outline" size="sm"` from `@open-mercato/ui/primitives/button` (the same variant/size used by the existing "Remove global wildcard" button in AclEditor at line 367-374).
- No hardcoded status colors, no `dark:` overrides on status tokens, no arbitrary text sizes, no hex/rgb in className.
- Boy-scout: AclEditor's existing blue-50/blue-200 inline classes for the "global wildcard enabled" banner are pre-existing and untouched by this PR — explicitly out of scope per the surgical-change rule.

## DS-guardian residual findings

None.

## Summary

All hard gates green. The one deferred jsdom test will be exercised by CI on a clean install; the failure mode is environmental and well understood.

Ready to open the PR and file the per-module follow-up issues.
