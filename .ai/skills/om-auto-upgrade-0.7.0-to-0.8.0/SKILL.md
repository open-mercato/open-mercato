---
name: om-auto-upgrade-0.7.0-to-0.8.0
description: Migrate downstream Open Mercato code from 0.7.0 to 0.8.0 with exact AlertDescription element-type and deal-status constant edits; audit entry.overrides dispatch, sales line discounts, repeated query params, device camelCase keys, the Communications Hub email switch, search-token reindexing, and portal role sync; validate the app; and report manual work. Use for "upgrade Open Mercato to 0.8.0", "migrate 0.7.0 to 0.8.0", "apply the 0.8.0 upgrade notes", or "zaktualizuj Open Mercato do 0.8.0".
---

# Auto upgrade 0.7.0 to 0.8.0

Apply the mechanical parts of the Open Mercato `0.7.0 → 0.8.0` upgrade to a downstream app. Treat the matching section of `UPGRADE_NOTES.md` as the source of truth and leave every intent-sensitive change as an explicit manual finding.

## Scope

Operate on a standalone app or downstream repository that depends on `@open-mercato/*`. Never modify the framework monorepo, framework-owned `packages/`, dependency pins, lockfiles, generated output, vendored dependencies, or secrets. Run after the user has selected and installed `0.8.0`.

## Arguments

- `--path <dir>`: downstream repository root; defaults to the current directory.
- `--dry-run`: detect, classify, and report without editing files or running mutating commands.
- `--only <id[,id...]>`: limit work to named checks.
- `--skip <id[,id...]>`: omit named checks and record the omission in the report.

Reject unknown flags and combining `--only` with `--skip`.

## Upgrade checks

| ID | Classification | Detect | Action |
| --- | --- | --- | --- |
| `entry-overrides-cli-workers` | Detect and report | `entry.overrides` declarations in `src/modules.ts` whose domain is `encryption`, `acl`, `cli`, `workers`, `events`, `setup`, `di`, or `ai`, and any `src/modules.ts` that fails to import | Report that each declaration now dispatches in the CLI, worker and scheduler bootstrap too, so a previously silent no-op becomes live behavior; call out `overrides.encryption.maps` (re-run `mercato entities seed-encryption` and re-encrypt fields that were silently skipped), `overrides.cli['<command>'] = null`, `overrides.setup.seedDefaults: false`, and `overrides.workers` / `overrides.events`; never delete or rewrite an override to restore the old no-op |
| `alert-description-div` | Automatic when exact; otherwise report | `HTMLParagraphElement` in a ref or event-handler type annotation that is bound to `AlertDescription` from `@open-mercato/ui/primitives/alert` | Rewrite only an exact `useRef<HTMLParagraphElement>` / `React.<Name>Event<HTMLParagraphElement>` annotation whose target is that component to `HTMLDivElement`; report every annotation whose target cannot be resolved to `AlertDescription` and leave block-`<span>` workarounds alone — they keep working |
| `deal-status-lost-constant` | Automatic when exact; otherwise report | Imports and references to `DEAL_STATUS_LOSE` from `@open-mercato/core/modules/customers/lib/dealStatus`, and literal `'loose'` status comparisons | Rename only the exact deprecated `DEAL_STATUS_LOSE` identifier to `DEAL_STATUS_LOST`, preserving the import shape; report literal `'loose'` comparisons for migration to `isLostDealStatus` and flag consumers of `canonicalDealStatus` output that must now expect `'lost'`; never rewrite stored data |
| `sales-line-discount-amount` | Detect and report | Request payloads for `/api/sales/orders`, `/api/sales/quotes`, `/api/sales/order-lines` and `/api/sales/quote-lines` that send `discountAmount: 0`, send `discountAmount` together with a non-zero `discountPercent`, or post a line-total amount | Report the new precedence rule (a non-zero percent wins, a stored `0` amount counts as absent) and the inverted `discountAmount: 0` case first, because it discounts twice rather than failing; recommend sending `discountPercent: 0` alongside an explicit amount, or `discountAmountBasis: 'line'` when the posted amount is already the whole line's discount; never edit money arithmetic or persisted totals automatically |
| `repeated-query-params` | Detect and report | Downstream `makeCrudRoute` list schemas whose filter params are typed `z.string()` and clients that send the same filter twice, plus `parseIdsParam` / `isIdsParamProvided` consumers | Report that a repeated occurrence now reaches the schema as `string[]` and a plain `z.string()` param answers `400` instead of silently using the last value; recommend widening genuinely multi-valued params to `z.union([z.string(), z.array(z.string())])` and normalizing with `toQueryValueList`; never widen a schema automatically — whether a param is multi-valued is the author's contract |
| `system-email-communications-hub` | Detect and report | A `src/modules.ts` with no `channel_resend` / `channel_ses` entry in an app that configures `SYSTEM_EMAIL_PROVIDER`, `RESEND_API_KEY`, or an SES sender, and direct provider-SDK email calls | Report that outbound system email now resolves a `communication_channels` row and its provider package, so an app scaffolded before 0.8.0 throws `No ChannelAdapter registered for providerKey 'resend'` on its first send with no boot-time warning; show the `src/modules.ts` entry and the matching dependency for the user to add; recommend migrating direct SDK calls to `sendEmail` and passing `tenantId`/`organizationId`; never add a dependency, edit a pin, or print a credential value |
| `devices-camelcase-keys` | Detect and report | Reads of `device_id`, `user_id`, `client_app_version`, `os_version`, `push_provider`, `push_token_updated_at`, `last_seen_at`, `created_at`, `updated_at`, `tenant_id` or `organization_id` from a `/api/devices` response | Report the canonical camelCase key for each and that the snake_case aliases still return the same value until they are removed, no earlier than the next minor release; note that timestamps now always serialize as ISO-8601 strings under both spellings; never rewrite a response reader whose source object cannot be proven to be a devices response |
| `interaction-participant-userid-optional` | Detect and report | `participants[].userId` dereferences without a guard, and hand-written or generated types that declare it required, against `/api/customers/interactions` | Report that `userId` is now optional because an external calendar guest is identified by email alone, and that a strict response validator rejects such a payload; recommend identifying a participant by `userId` when present and by the normalized email otherwise, matching `lib/calendar/participantIdentity.ts`; never relax a validator automatically |
| `deal-status-canonical-vocabulary` | Detect and report | Raw `win` / `won` / `loose` / `lost` / `closed` deal-status filtering outside `@open-mercato/core/modules/customers/lib/dealStatus` | Report that filters now expand through the canonical vocabulary, that the seeded `closed` option matches the whole terminal set, and that closing a deal by status alone now derives `closureOutcome` and relocates the deal to a terminal stage while a non-terminal update clears the loss columns; recommend `expandDealStatusAliases` / `isClosedDealStatus`; never rewrite closure intent |
| `search-token-fold-reindex` | Detect and report | `tokenizeText` output persisted outside `search_tokens`, and any installation whose indexed text contains `ł`, `ø`, `đ`, `ð`, `þ`, `ħ`, `ı`, `ĸ`, `ŋ`, `ŧ`, `æ`, `œ` or `ß` | Report that the token value and its `token_hash` changed for those records only, so they stay unfindable until reindexed, and carry `yarn mercato search reindex` (or `yarn mercato query_index rebuild-all`) as operator work; note the backend users-list filter routes through the token path even on Meilisearch installations; never run a reindex against the user's data without explicit confirmation |
| `time-project-fixture-customer` | Detect and report | `createTimeProjectFixture(request, token)` calls from `@open-mercato/core/helpers/integration/timesheetFixtures` with no `customerId`, or a blank one | Report that the helper now throws at the call site instead of letting the route answer `422` further downstream, and that a customer id must be created first — `createCompanyFixture` from `@open-mercato/core/helpers/integration/crmFixtures` returns one; never invent, reuse, or default a customer id in a spec |
| `supported-locales-ui-switcher` | Detect and report | An installation with a saved tenant-scoped `translations.supported_locales` config value | Report that the value now also governs the admin language switcher and what `detectLocale()` accepts from a `locale` cookie or `Accept-Language` header, not just the content-translation editor, and require the saved selection to be reviewed **before** deploying; never edit a tenant's stored config |
| `customer-role-acl-sync` | No code action | Deployments with the `customer_accounts` module and modules declaring `setup.defaultCustomerRoleFeatures` | Explain that `yarn mercato auth sync-role-acls` now merges portal/customer role grants after the staff ones, so a newly shipped portal page reaches existing `Buyer` and `Viewer` roles; the merge is additive and idempotent and never removes an operator's customizations; run it once per upgrade |
| `phone-call-encryption-backfill` | No code action | Tenants that predate the `phone_calls` module | Explain that `Migration20260822120000` backfills both `phone_calls` encryption maps on `yarn db:migrate`, so the standard migrate-then-deploy flow needs no operator action and has no plaintext window; name the two heal paths for a tenant that enabled encryption after upgrading — the `phone_calls.seed-call-encryption-maps` upgrade action and re-running `mercato entities seed-encryption` per tenant — and that rows ingested without maps stay plaintext until re-ingested |
| `locale-registry-augmentation` | No code action | Apps with exhaustive `Record<Locale, …>` maps or `switch` statements over `Locale` | Explain that `Locale` is now `keyof LocaleRegistry & string` rather than a closed union, that an unaugmented app resolves to exactly the same five-member union and keeps its exhaustiveness, and that no new language ships; show the `declare module` augmentation plus runtime registration only for an app that wants to serve a language the platform does not ship |

## Workflow

### 1. Gate the target

Resolve `--path`, require a regular `package.json`, and confirm at least one dependency or development dependency starts with `@open-mercato/`. Refuse to run when the target has the framework monorepo signature, including its core and shared workspace packages.

Inspect installed and pinned Open Mercato versions. Continue when they resolve to `0.8.0`; otherwise warn with the detected versions and require explicit user confirmation before edits. A dry run may continue without confirmation.

Exclude `.git/`, `node_modules/`, `.yarn/`, `.next/`, `dist/`, `build/`, `coverage/`, `.mercato/generated/`, generated registries, vendor directories, and framework-owned packages from every scan. Follow symlinks neither while scanning nor editing. Never print environment-variable values or other secret-bearing content.

### 2. Build and show the plan

Run every selected detection before editing. Report each match as `{checkId, file, line, classification, proposedAction}`. For environment matches, report only the variable name, file, and line number, never the value. Show totals by check and distinguish exact automatic matches from manual candidates.

For `alert-description-div`, an automatic match is a `HTMLParagraphElement` type argument in a `useRef` or `React.*Event` annotation whose value is demonstrably passed to `AlertDescription` in the same file; preserve indentation, quote style, and semicolon style. For `deal-status-lost-constant`, require the literal `DEAL_STATUS_LOSE` identifier resolved to the customers `dealStatus` module — a bare `'loose'` string is always a manual candidate, because a read alias is still valid and only the caller knows whether the site is a write. Downgrade every broader or ambiguous shape to detect-and-report.

With `--dry-run`, print the complete plan, all no-code-action reminders, and unresolved manual work, then stop without edits, package-manager commands, generation, tests, or builds.

### 3. Apply bounded edits

Ask for confirmation of the displayed plan. Apply one minimal, idempotent edit per exact match:

- Change the exact `HTMLParagraphElement` type argument bound to `AlertDescription` to `HTMLDivElement`.
- Rename the exact deprecated `DEAL_STATUS_LOSE` identifier to `DEAL_STATUS_LOST`, including its import specifier, without touching the `'loose'` value it still equals.

Preserve file encoding, line endings, and unrelated formatting. Re-scan after editing: exact old shapes must be absent, while every manual candidate remains listed. Never perform repository-wide string replacement.

### 4. Verify

Use the package manager and scripts declared by the downstream app; do not assume monorepo-only commands exist. Run, in order when present:

1. the configured generation script;
2. the configured typecheck script;
3. the smallest affected test script, otherwise the configured test script;
4. the configured build script.

Stop at the first new failure caused by an automatic edit, revert only that edit, and move the match to manual follow-up. Preserve and report pre-existing failures rather than rewriting unrelated code or weakening checks.

### 5. Report

Report:

- the target path and detected Open Mercato versions;
- the complete pre-edit plan and user confirmation;
- every edited file grouped by automatic check ID;
- every detect-and-report finding, with exact file and line;
- every no-code-action reminder, no-match check, and skipped check;
- validation commands and outcomes;
- unresolved operational work: the `translations.supported_locales` review before deployment, the `entry.overrides` re-check and `entities seed-encryption` re-run, the `auth sync-role-acls` run for portal roles, the search reindex, the `discountAmount: 0` audit, the Communications Hub module registration and per-tenant email seeding, and the phone-call encryption heal paths where applicable.

If no code changes were required, still report that all fifteen upgrade categories ran. Recommend reviewing the complete `0.7.0 → 0.8.0` section of `UPGRADE_NOTES.md` before deployment.

## Rules

- Every automatic edit must be exact, bounded, minimal, and idempotent.
- Never change dependency versions, lockfiles, generated output, vendor files, framework-owned packages, or secrets.
- Never rewrite discount arithmetic, persisted totals, or stored deal status; report them and let the owner decide.
- Never widen a list-route schema, relax a response validator, broaden a role's grants, or edit a tenant's stored config automatically.
- Never run a reindex, a migration, a seed, or `auth sync-role-acls` against the user's data without explicit confirmation.
- Never print a credential, an API key, or an environment value while reporting the Communications Hub email switch.
- Never weaken typecheck, tests, or build to make the upgrade appear green.
- Always show the edit plan before mutation and the exact changed-file list afterward.
