---
name: om-auto-upgrade-0.6.7-to-0.7.0
description: Migrate downstream Open Mercato code from 0.6.7 to 0.7.0 with exact TanStack, settings-group, and removed-env edits; audit auth, search, workflow, facts, Redis, webhook, and security-header changes; validate the app; and report manual work. Use for "upgrade Open Mercato to 0.7.0", "migrate 0.6.7 to 0.7.0", "apply the 0.7.0 upgrade notes", or "zaktualizuj Open Mercato do 0.7.0".
---

# Auto upgrade 0.6.7 to 0.7.0

Apply the mechanical parts of the Open Mercato `0.6.7 → 0.7.0` upgrade to a downstream app. Treat the matching section of `UPGRADE_NOTES.md` as the source of truth and leave every intent-sensitive change as an explicit manual finding.

## Scope

Operate on a standalone app or downstream repository that depends on `@open-mercato/*`. Never modify the framework monorepo, framework-owned `packages/`, dependency pins, lockfiles, generated output, vendored dependencies, or secrets. Run after the user has selected and installed `0.7.0`.

## Arguments

- `--path <dir>`: downstream repository root; defaults to the current directory.
- `--dry-run`: detect, classify, and report without editing files or running mutating commands.
- `--only <id[,id...]>`: limit work to named checks.
- `--skip <id[,id...]>`: omit named checks and record the omission in the report.

Reject unknown flags and combining `--only` with `--skip`.

## Upgrade checks

| ID | Classification | Detect | Action |
| --- | --- | --- | --- |
| `passkey-mfa-assertion` | Detect and report | Callers that post `{ credentialId, challenge }`, or a bare credential id, to `POST /api/security/mfa/verify` or `POST /api/security/sudo/verify`, and custom passkey enrollment paths | Report the removed payload shape and require the object returned by `startAuthentication()` as `payload.response`; carry the operator actions for credentials enrolled through the still-open attestation shortcut (#5296) and never delete or reset MFA rows automatically |
| `jwt-secret-required` | Detect and report | `${JWT_SECRET:-…}` defaults in compose files, `JWT_SECRET` or `JWT_<AUDIENCE>_SECRET` values that are absent, shorter than 32 characters, or a published placeholder, and `JWT_LEGACY_GRACE_MINUTES` set without `JWT_LEGACY_CUTOVER_AT` | Report the required operator steps before the production rollout, including the legacy-token cutover decision; never generate, print, or write a secret value into a repository file |
| `standalone-ds-i18n-gates` | Detect and report | Standalone apps missing `scripts/ds-check.mjs`, `scripts/i18n-check-hardcoded.mjs`, the matching `package.json` scripts, the `typecheck` memory headroom, or `yarn ds:check` in `.ai/agentic.config.json` `validation.commands` | Report the copy-and-register steps against the current template and the reasoned `.ds-check-ignore` baseline; keep `yarn i18n:check-hardcoded` advisory and never add a hard-failing gate to a user's config unprompted |
| `module-fact-sheet-directories` | Automatic when exact; otherwise report | Literal `.ai/guides/modules/<id>.md` or `.ai/guides/reference-modules/<id>.md` reads in harness scripts, skills, or docs | Rewrite only an exact flat-sheet path to the `<id>/index.md` form; report globs, manifest-driven readers, and any consumer that enumerated the flat layout |
| `user-confirmation-semantics` | Detect and report | User creation, setup, or update code that writes `isConfirmed: false` | Report each write whose users are still expected to authenticate; do not invent a replacement field |
| `audit-log-context-shape` | Detect and report | Command interceptors returning `metadata.context`, and consumers that assume keys are absent from `ActionLog.context_json` | Explain the new `metadata.logContext` input and shallow-merge precedence; do not rewrite ownership-sensitive logging code |
| `global-search-acl` | Detect and report | Clients of `/api/search/search/global` authorized only by `search.view`, custom `search.ts` entities without `aclFeatures`, and custom-entity search consumers | Report the required `search.global` grant and per-entity view features; include the post-upgrade role-ACL sync command as manual work |
| `hybrid-search-acl` | Detect and report | Callers of `GET /api/search/search` authorized only by `search.view`, and custom `search.ts` entities that declare no `aclFeatures` | Report the per-entity view features those callers now need and the fail-closed behaviour for entity types without `aclFeatures`; point at `OM_SEARCH_DEBUG=true` for the dropped-type diagnosis and never widen a role's grants automatically |
| `preset-search-module` | No code action | Existing `crm` or `empty` apps whose module registry omits `search` | Explain that only new scaffolds changed and show the optional module registration for apps that want Cmd+K search |
| `data-sync-batch-traces` | Detect and report | Adapter `streamImport`/`streamExport` implementations that return a synchronous iterable of promises, hand-rolled per-batch spans, and saved traces or dashboards that assumed sync work nested under the triggering request | Report the enforced genuine `AsyncIterable` contract, the now-redundant adapter span, and the new `data_sync.*.batch` root traces reached through a span link; never rewrite an adapter's iteration protocol automatically |
| `tanstack-table-v9` | Automatic when exact; otherwise report | Root imports of `ColumnDef`, `useReactTable`, row-model factories, renamed state/function types, and Jest transform allowlists | Rewrite only an exact single-specifier type import of `ColumnDef` to `LegacyColumnDef as ColumnDef` from `@tanstack/react-table/legacy`; report combined imports, hooks, generics, renamed types, and Jest config for review |
| `ioredis-resp2` | Detect and report | Direct `ioredis` construction that does not use shared connection helpers or `REDIS_WIRE_PROTOCOL` | Report the client and require an explicit RESP2 decision; never inject connection options blindly |
| `sales-line-default-order` | No code action | Consumers of order-line or quote-line list endpoints that pass no explicit sort | Explain the new `line_number ASC, id ASC` default, cache-TTL caveat, and `?sortField=id` compatibility choice |
| `workflow-unresolved-templates` | Detect and report | Source-controlled `UPDATE_ENTITY` inputs or `EMIT_EVENT` payloads containing literal `{{...}}` templates | Report candidates that may intentionally pass braces through and require review of stored workflow definitions; never escape or relocate templates automatically |
| `credential-free-integrations` | No code action | Integrations or bundles declaring an effective credentials schema with `fields: []` | Explain that they now resolve as configured and that inherited bundle credentials still win |
| `removed-example-injection-flag` | Automatic when exact; otherwise report | `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED` in environment files, deployment config, source, or copied example injection registries | Remove only an exact assignment line in a regular `.env*` file without displaying its value; report every other occurrence and every conditional registry for manual simplification |
| `module-facts-v2` | Detect and report | Direct readers of `.ai/guides/module-facts.json`, explicit `factsContractVersion: 1`, pinned contribution IDs/modes, and extension-table workarounds | Report migration to the v2 sidecar/default extractor contract and require consumers to repin intentionally; do not rewrite fact IDs or explicit extension tables |
| `settings-section-group-id` | Automatic when exact; otherwise report | Injected `groupId` values and `buildSettingsSections` order maps keyed by rendered-label slugs | Replace only the exact `groupId: 'module-configs'` or double-quoted equivalent with `settings.sections.moduleConfigs`, preserving quote style; report every other slug and `sectionOrder` key |
| `webhook-body-limits` | No code action | Public webhook deployments and custom payment handler registrations | Report the 1 MiB global ceiling, the InboxOps override, proxy-limit alignment, and provider verification required before opting payment handlers into `maxBodyBytes` |
| `standalone-security-headers` | Detect and report | Standalone `next.config.*` files missing the current CSP and attachment sandbox headers | Point to the latest template and require a manual merge that preserves provider origins and the attachment sandbox; never replace a whole Next.js config |
| `sidebar-preference-null` | Detect and report | Callers of `loadSidebarPreference` from `@open-mercato/core/modules/auth/services/sidebarPreferencesService` | Report the `findSidebarPreference` replacement and its `null` contract, and warn that feeding the fabricated default object back into `applySidebarPreference` erases the role layer; leave intentional default-object callers to `(await findSidebarPreference(em, scope)) ?? normalizeSidebarSettings(null)` |

## Workflow

### 1. Gate the target

Resolve `--path`, require a regular `package.json`, and confirm at least one dependency or development dependency starts with `@open-mercato/`. Refuse to run when the target has the framework monorepo signature, including its core and shared workspace packages.

Inspect installed and pinned Open Mercato versions. Continue when they resolve to `0.7.0`; otherwise warn with the detected versions and require explicit user confirmation before edits. A dry run may continue without confirmation.

Exclude `.git/`, `node_modules/`, `.yarn/`, `.next/`, `dist/`, `build/`, `coverage/`, `.mercato/generated/`, generated registries, vendor directories, and framework-owned packages from every scan. Follow symlinks neither while scanning nor editing. Never print environment-variable values or other secret-bearing content.

### 2. Build and show the plan

Run every selected detection before editing. Report each match as `{checkId, file, line, classification, proposedAction}`. For environment matches, report only the variable name, file, and line number, never the value. Show totals by check and distinguish exact automatic matches from manual candidates.

For `tanstack-table-v9`, an automatic match is exactly one type-only import whose only specifier is `ColumnDef`; preserve indentation, quote style, and semicolon style. For `settings-section-group-id`, require the literal `groupId` property and the exact `module-configs` value. For `removed-example-injection-flag`, require a single exact assignment line in a regular `.env*` file. For `module-fact-sheet-directories`, require a literal flat sheet path — a glob, a manifest-driven read, or any consumer that enumerated the flat layout is a manual candidate. Downgrade every broader or ambiguous shape to detect-and-report.

With `--dry-run`, print the complete plan, all no-code-action reminders, and unresolved manual work, then stop without edits, package-manager commands, generation, tests, or builds.

### 3. Apply bounded edits

Ask for confirmation of the displayed plan. Apply one minimal, idempotent edit per exact match:

- Repoint the exact `ColumnDef` type import to `LegacyColumnDef as ColumnDef` at the legacy entry point.
- Replace the exact settings `groupId` slug with `settings.sections.moduleConfigs`.
- Delete only the exact removed-flag assignment line from a `.env*` file without reading its value into the report.
- Repoint the exact flat module fact-sheet path to its `<id>/index.md` form.

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
- unresolved operational work: the `JWT_SECRET` and legacy-token cutover decision, passkey credentials enrolled through the attestation shortcut, role-ACL sync for the global and hybrid search gates, stored workflow review, Redis protocol choice, webhook/proxy ceilings, design-system and i18n gate adoption, and standalone header adoption where applicable.

If no code changes were required, still report that all twenty-one upgrade categories ran. Recommend reviewing the complete `0.6.7 → 0.7.0` section of `UPGRADE_NOTES.md` before deployment.

## Rules

- Every automatic edit must be exact, bounded, minimal, and idempotent.
- Never change dependency versions, lockfiles, generated output, vendor files, framework-owned packages, or secrets.
- Never display environment values while removing the obsolete example-injection flag.
- Never broaden auth grants, invent ACL features, rewrite stored workflow intent, repin generated fact IDs, or weaken CSP automatically.
- Never generate, print, or persist a `JWT_SECRET`, and never delete or reset a user's MFA credentials while reporting the passkey change.
- Never weaken typecheck, tests, or build to make the upgrade appear green.
- Always show the edit plan before mutation and the exact changed-file list afterward.
