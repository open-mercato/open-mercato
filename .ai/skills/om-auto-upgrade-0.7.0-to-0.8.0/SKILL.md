---
name: om-auto-upgrade-0.7.0-to-0.8.0
description: Migrate downstream Open Mercato code from 0.7.0 to 0.8.0 — audit entry.overrides CLI/worker/scheduler dispatch, sales line discount_amount semantics, AlertDescription ref types, devices API camelCase, deal-status "lost" spelling and canonical vocabulary, the outbound-email Communications Hub provider module, interaction participant userId, makeCrudRoute repeated query params, and createTimeProjectFixture's customerId; validate the app; and report manual work. Use for "upgrade Open Mercato to 0.8.0", "migrate 0.7.0 to 0.8.0", "apply the 0.8.0 upgrade notes", or "zaktualizuj Open Mercato do 0.8.0".
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
| `locale-registry-widen` | No code action | Any use of the published `Locale` type from `@open-mercato/shared/lib/i18n/config` | Explain that `Locale` now derives from an augmentable `LocaleRegistry` interface but resolves identically when unaugmented — no action unless the app wants to serve an additional language via `declare module` + `registerLocales` |
| `translations-locale-switcher-review` | No code action | N/A — this is a tenant configuration review, not a code pattern | Report that a tenant with a narrowed `translations.supported_locales` selection now also narrows the admin UI language switcher and the accepted `POST`/`GET /api/auth/locale` set; require reviewing that saved selection before deploying |
| `entry-overrides-cli-worker-scheduler` | Detect and report | `overrides.encryption`, `overrides.cli`, `overrides.setup.seedDefaults`, `overrides.workers`, or `overrides.events` declared in the app's `src/modules.ts` | Report that these now dispatch in CLI/worker/scheduler processes too (previously Next.js-runtime only); flag `overrides.encryption.maps` specifically and require re-running `mercato entities seed-encryption` after upgrading; never rewrite override intent automatically |
| `sync-role-acls-portal` | No code action | N/A — operational command | Recommend running `yarn mercato auth sync-role-acls` once after upgrading so newly declared `setup.defaultCustomerRoleFeatures` portal grants reach existing customer/portal roles |
| `sales-line-discount-amount-contract` | Detect and report | Callers of `/api/sales/orders`, `/api/sales/quotes`, `/api/sales/order-lines`, `/api/sales/quote-lines` that send `discountAmount` and `discountPercent` together, or send `discountAmount: 0` to suppress an inherited percent | Report the new precedence (percent wins when set and non-zero; a stored `discountAmount` of `0` now counts as absent) and the `discountAmountBasis: 'unit' \| 'line'` escape hatch; flag `discountAmount: 0` call sites as the dangerous case; never rewrite request payloads automatically |
| `search-token-fold-reindex` | No code action | Direct imports/calls of `tokenizeText` from `@open-mercato/shared/lib/search/tokenize` outside the search module, or any stored copy of its output | Recommend `yarn mercato search reindex` after upgrading (harmless if run unconditionally); if `tokenizeText` output was persisted elsewhere, report that it must be recomputed |
| `alert-description-html-element` | Detect and report | `useRef<HTMLParagraphElement>` or a `React.*Event<HTMLParagraphElement>` annotation used together with `AlertDescription` from `@open-mercato/ui/primitives/alert` | Report that `AlertDescription` now renders a `<div>`, so the ref/event element type must become `HTMLDivElement`; never rewrite a ref type automatically since a false-positive match compiles silently wrong |
| `devices-api-camelcase` | Detect and report | Reads of the deprecated snake_case keys (`device_id`, `user_id`, `last_seen_at`, `client_app_version`, `os_version`, `push_provider`, `push_token_updated_at`, `created_at`, `updated_at`, `tenant_id`, `organization_id`) from `GET /api/devices`, `GET /api/devices/admin/devices`, or `GET /api/devices/admin/devices/:id` responses | Report the canonical camelCase key for each match; both spellings are served today, so this is forward migration, not urgent breakage |
| `deal-status-lost-not-loose` | Detect and report | References to `DEAL_STATUS_LOSE`, or a literal `'loose'` string comparison against `customer_deals.status` outside `@open-mercato/core/modules/customers/lib/dealStatus.ts` | Report the `DEAL_STATUS_LOST` rename (`DEAL_STATUS_LOSE` still exports `'loose'`, deprecated, removal no earlier than 0.9.0) and require `isLostDealStatus` for literal comparisons; never rewrite a comparison automatically since intent (matching stored vs. canonical) varies |
| `outbound-email-communications-hub` | Detect and report | An app that calls `sendEmail` from `@open-mercato/shared/lib/email/send` (directly or via password-reset/invitation/MFA/notification flows) but whose `src/modules.ts` has no `channel_resend` and no `channel_ses` entry | Report that the provider package (`@open-mercato/channel-resend` and/or `@open-mercato/channel-ses`) must be added as a dependency at the app's `@open-mercato/*` version and registered in `src/modules.ts`, matching `SYSTEM_EMAIL_PROVIDER` — an app scaffolded before 0.8.0 that skips this throws `No ChannelAdapter registered for providerKey 'resend'` on first send with no boot-time warning; never add the dependency or edit `package.json` automatically |
| `interaction-participant-optional-userid` | Detect and report | Code that reads `participants[].userId` from `GET /api/customers/interactions` (or the generated OpenAPI type) and assumes it is always present | Report that `userId` is now optional and a userId-less participant carries `email` instead; recommend keying on `userId` when present, falling back to normalized `email` (matching `lib/calendar/participantIdentity.ts`) |
| `deal-status-canonical-vocabulary` | Detect and report | Deal-status filtering or comparison code outside `expandDealStatusAliases` / `isClosedDealStatus` in `@open-mercato/core/modules/customers/lib/dealStatus.ts` that matches raw `win`/`won`/`loose`/`lost`/`closed` spellings | Report the shared helpers and that the seeded `closed` option now matches the whole terminal set instead of the literal string `closed`; never rewrite filter logic automatically |
| `crud-route-repeated-query-params` | Detect and report | A `makeCrudRoute` list-route schema that types a filter param as a plain `z.string()` where a client may legitimately repeat the query parameter | Report that a repeated occurrence of that param now returns `400` instead of silently keeping the last value; where the param is genuinely multi-valued, recommend widening it to `z.union([z.string(), z.array(z.string())])` and normalizing with `toQueryValueList`; never widen a schema automatically |
| `time-project-fixture-customer-id` | Detect and report | Calls to `createTimeProjectFixture` from `@open-mercato/core/helpers/integration/timesheetFixtures` that omit the `customerId` field in the options object | Report that the call now throws before the request is made (previously a `422` from the route with no indication of the cause) and require passing a `customerId`, e.g. from `createCompanyFixture` |
| `phone-calls-pii-encryption-backfill` | No code action | N/A — operational data migration | Explain that `yarn db:migrate` runs a forward-only idempotent migration that backfills `phone_calls` encryption maps for every scope with active encryption; report the `phone_calls.seed-call-encryption-maps` Upgrade Action and the manual `entities seed-encryption` CLI as fallback heal paths for a tenant that enabled encryption after upgrading |

## Workflow

### 1. Gate the target

Resolve `--path`, require a regular `package.json`, and confirm at least one dependency or development dependency starts with `@open-mercato/`. Refuse to run when the target has the framework monorepo signature, including its core and shared workspace packages.

Inspect installed and pinned Open Mercato versions. Continue when they resolve to `0.8.0`; otherwise warn with the detected versions and require explicit user confirmation before edits. A dry run may continue without confirmation.

Exclude `.git/`, `node_modules/`, `.yarn/`, `.next/`, `dist/`, `build/`, `coverage/`, `.mercato/generated/`, generated registries, vendor directories, and framework-owned packages from every scan. Follow symlinks neither while scanning nor editing. Never print environment-variable values or other secret-bearing content.

### 2. Build and show the plan

Run every selected detection before editing. Report each match as `{checkId, file, line, classification, proposedAction}`. Distinguish exact automatic matches (none in this window) from detect-and-report candidates, and list every no-code-action reminder even when no file match applies.

With `--dry-run`, print the complete plan, all no-code-action reminders, and unresolved manual work, then stop without edits, package-manager commands, generation, tests, or builds.

### 3. Apply bounded edits

This upgrade window has no check classified purely `Automatic` — every match requires human judgement about intent (a ref-type rewrite, a filter-schema widening, a dependency addition). Skip straight to reporting; do not perform speculative edits.

### 4. Verify

Use the package manager and scripts declared by the downstream app; do not assume monorepo-only commands exist. Run, in order when present:

1. the configured generation script;
2. the configured typecheck script;
3. the smallest affected test script, otherwise the configured test script;
4. the configured build script.

Preserve and report pre-existing failures rather than rewriting unrelated code or weakening checks.

### 5. Report

Report:

- the target path and detected Open Mercato versions;
- the complete plan (this window produces no automatic edits, so no edited-file list);
- every detect-and-report finding, with exact file and line;
- every no-code-action reminder, no-match check, and skipped check;
- validation commands and outcomes;
- unresolved operational work: the `entry.overrides` re-review (and `seed-encryption` re-run if `overrides.encryption.maps` is declared), `yarn mercato auth sync-role-acls`, the sales line `discountAmount: 0` audit, the search reindex, the outbound-email provider package/module registration, and the phone_calls encryption-map heal path if the app runs that module.

If no code changes were required, still report that all fifteen upgrade categories ran. Recommend reviewing the complete `0.7.0 → 0.8.0` section of `UPGRADE_NOTES.md` before deployment.

## Rules

- Never change dependency versions, lockfiles, generated output, vendor files, framework-owned packages, or secrets.
- Never widen a `makeCrudRoute` schema, rewrite a deal-status comparison, or change a ref/event generic type automatically — every match in this window is intent-sensitive.
- Never register the email provider module or edit `package.json` automatically — report the exact lines to add instead.
- Never weaken typecheck, tests, or build to make the upgrade appear green.
- Always show the edit plan before mutation and the exact changed-file list afterward (empty for this window unless a future revision adds an automatic check).
