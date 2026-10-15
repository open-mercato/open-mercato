---
name: om-auto-upgrade-0.8.0-to-0.9.0
description: Migrate downstream Open Mercato code from 0.8.0 to 0.9.0 — enable progress before customers in src/modules.ts, and audit catalog bulk-delete job scope, redoInput for secret-bearing commands, thrown CrudHttpError statuses, resolveAttachmentRequestScope, directory organization parentId/childIds omission, SUB_WORKFLOW output ports, accent-insensitive search helpers, OpenAI-compatible preset apiMode, snapshot date revival, Gmail oauthClient, host locale overrides, CrudForm injected field ids, ChannelScope null organizations, duplicate ai_assistant encryption maps, WRONG_KEY encryption errors, the telemetry bootstrap, SSE API-key consumers, empty organization scopes, and the route-identity header; validate the app; and report manual work. Use for "upgrade Open Mercato to 0.9.0", "migrate 0.8.0 to 0.9.0", "apply the 0.9.0 upgrade notes", or "zaktualizuj Open Mercato do 0.9.0".
---

# Auto upgrade 0.8.0 to 0.9.0

Apply the mechanical parts of the Open Mercato `0.8.0 → 0.9.0` upgrade to a downstream app. Treat the matching section of `UPGRADE_NOTES.md` as the source of truth and leave every intent-sensitive change as an explicit manual finding.

## Scope

Operate on a standalone app or downstream repository that depends on `@open-mercato/*`. Never modify the framework monorepo, framework-owned `packages/`, dependency pins, lockfiles, generated output, vendored dependencies, or secrets. Run after the user has selected and installed `0.9.0`.

## Arguments

- `--path <dir>`: downstream repository root; defaults to the current directory.
- `--dry-run`: detect, classify, and report without editing files or running mutating commands.
- `--only <id[,id...]>`: limit work to named checks.
- `--skip <id[,id...]>`: omit named checks and record the omission in the report.

Reject unknown flags and combining `--only` with `--skip`.

## Upgrade checks

| ID | Classification | Detect | Action |
| --- | --- | --- | --- |
| `catalog-bulk-delete-job-scope` | Detect and report | Enqueues on `CATALOG_PRODUCT_BULK_DELETE_QUEUE` or direct calls to `deleteCatalogProductsWithProgress` from `@open-mercato/core/modules/catalog/lib/bulkDelete` | Report that `scope.tenantId`, `scope.organizationId` and `scope.userId` are now all required — a job missing any of them fails before deleting anything; callers that only use `POST /api/catalog/bulk-delete` need nothing |
| `command-redo-input-secrets` | Detect and report | App command handlers whose `buildLog` returns `replayable: false`, or whose input carries a `password`/`secret`/`token`/`apiKey` field persisted through `buildLog` | Recommend returning a redacted `redoInput` projection on the log metadata instead of `replayable: false` (which also drops the undo token); keep `replayable: false` only where replay can never be made safe; never rewrite a `buildLog` automatically |
| `user-create-redo-password-reset` | No code action | N/A — operator procedure | Explain that redoing an `auth.users.create` restores the account without a credential; the operator must send a password reset afterwards |
| `crud-http-error-status` | Detect and report | Tests or clients that assert a `500` from an app route guard, and API route `catch` blocks that convert every error into a `500` without `isCrudHttpError` from `@open-mercato/shared/lib/crud/errors` | Report that the `/api/[...slug]` dispatcher now answers an escaped `CrudHttpError` with its own status; a handler may `throw forbidden()` / `notFound()` / `conflict()` directly; update assertions that expected `500` |
| `attachment-request-scope` | Detect and report | Imports of `resolveAttachmentOrganizationId` from `@open-mercato/core/modules/attachments/lib/requestScope` | Report the deprecation and that it now throws `forbidden()` for a denied scope instead of returning `null`; recommend `resolveAttachmentRequestScope(container, auth, request)` and answering `{ denied }` with the route's documented status; never rewrite the call automatically since the return shape changes |
| `directory-organization-hierarchy-omission` | Detect and report | Callers of `PUT /api/directory/organizations`, `PUT /api/directory/organization-branding`, or the `directory.organizations.update` command that omit `parentId`/`childIds` expecting the hierarchy to be cleared | Report that omitted fields are now left untouched; a caller that relied on omission must send `parentId: null` / `childIds: []`; flag payloads sending `childIds` without `parentId`, which can now return `400 Child cannot equal parent`. Also remind operators to audit the action log for trees already flattened by the old behavior |
| `subworkflow-output-ports` | Detect and report | Workflow definitions (code or seeded JSON) with a `SUB_WORKFLOW` step whose child declares `definition.io.outputs` | Report that every declared child output port is now validated and coerced before `config.outputMapping`; a required port missing from the child context or an uncoercible value now fails with `OUTPUT_VALIDATION`; require the author to satisfy or relax (`required: false`, broader type) each declared port; never edit a workflow definition automatically |
| `catalog-unaccent-extensions` | No code action | N/A — database operation | Explain that the migration installs `unaccent` and `pg_trgm`; the migrating role needs `CREATE` on the database (and a managed provider may need the extensions allowlisted); deploy the migration before the new code, otherwise product search fails with `function om_immutable_unaccent(text) does not exist` |
| `accent-insensitive-contains-pattern` | Detect and report | Calls to the deprecated `buildAccentInsensitivePatternSql` from `@open-mercato/shared/lib/db/accentInsensitiveSearch`, and any hand-written accent-insensitive predicate on `catalog_products` | Recommend `buildAccentInsensitiveContainsPatternSql()` bound to the **raw** search term (it unaccents, escapes, and adds the surrounding `%` itself), dropping any prior `escapeLikePattern`/`%` wrapping; recommend building custom `catalog_products` predicates from the same module so they match the trigram index; never rewrite SQL automatically |
| `openai-compatible-preset-api-mode` | Detect and report | Calls to `createOpenAICompatibleProvider` from `@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/openai` with a preset that has no `apiMode` | Report that a preset without `apiMode` now calls `POST {baseURL}/chat/completions`; add `apiMode: 'responses'` only if the backend implements the Responses API and the app relies on it |
| `snapshot-date-revival` | Detect and report | Calls to `reviveSnapshotSeed` (`@open-mercato/shared/lib/commands/redo`) and `extractUndoPayload` (`@open-mercato/shared/lib/commands/undo`) in app undo handlers that assign snapshot date fields to entities | Report that `reviveSnapshotSeed` now throws `[internal] Invalid <field> snapshot date` for an unparsable date; recommend passing `{ datePaths }` or `{ dateFields }` to `extractUndoPayload` where snapshot dates are assigned to entities |
| `gmail-oauth-client-required` | Detect and report | Custom callers or test fixtures that invoke `refreshCredentials` on the Gmail adapter without `oauthClient`, or that place a `_client` key on Gmail credentials | Report that the `credentials._client` fallback is removed — a missing `oauthClient` now throws and `_client` is ignored; require passing `oauthClient: { clientId, clientSecret, scopes? }` |
| `host-locale-overrides-module-keys` | Detect and report | Keys in the app's `src/i18n/<locale>.json` that also exist in an installed `@open-mercato/*` module dictionary with a different value | Report every collision: the host value now wins over the module value; require the user to keep intended overrides and delete stale duplicates; never delete a locale key automatically |
| `crudform-injected-field-id-reuse` | Detect and report | `crud-form:<entityId>:fields` widgets whose injected field `id` equals a field the host form declares | Report that the injected value now reaches host schema validation and `onSubmit`; if the reuse is deliberate, make the value match the host schema; if accidental and the widget persists the value in `onSave`, rename the injected id |
| `channel-scope-nullable-organization` | Detect and report | Communication channel adapter implementations whose `fetchHistory`, `applyPushNotification`, `sendReaction`, or `removeReaction` read `input.scope.organizationId` | Report that `scope` is now `ChannelScope` (`{ tenantId: string; organizationId: string \| null }`, exported from `@open-mercato/core/modules/communication_channels/lib/adapter`) and `null` means a tenant-wide channel; typecheck flags passing it where a `string` is required; never pick a fallback organization automatically |
| `customers-requires-progress` | Automatic when exact; otherwise report | `src/modules.ts` enables `customers` from `@open-mercato/core` and has no `progress` entry | Insert `{ id: 'progress', from: '@open-mercato/core' },` immediately before the exact single-line `customers` entry; otherwise report the line to add. `yarn generate` now fails with `Module "customers" requires: progress` without it |
| `ai-assistant-duplicate-encryption-maps` | Detect and report | App `encryption.ts` files whose `defaultEncryptionMaps` declare `ai_assistant:ai_chat_message`, `ai_assistant:ai_chat_conversation`, or `ai_assistant:ai_pending_action` | Report that the app now fails to start with `Duplicate default encryption map for "ai_assistant:…"`; require deleting those entries, or moving a deliberately different field set to `overrides.encryption.maps['ai_assistant:…']` in `src/modules.ts`; recommend `yarn mercato entities seed-encryption --tenant <tenantId>` for existing tenants |
| `encryption-wrong-key-error` | Detect and report | Direct calls to `encryptEntityPayload` or `encryptFields` in app code | Report that a value sealed under a different key now raises `TenantDataEncryptionError` with code `WRONG_KEY` instead of being double-encrypted; flag call sites that swallow errors so the failure reaches an operator |
| `company-create-form-spot` | No code action | Widgets targeting `crud-form:customers.company` or `crud-form:customers.customer_entity` | Explain that the company create page now publishes `crud-form:customers.company` and still dual-publishes the legacy spot; widgets on the declared host now also render in create mode (no `recordId`) |
| `telemetry-otlp-startup` | Detect and report | `TELEMETRY_BACKEND` set to `otlp`, `signoz`, or `newrelic` (report name and file only, never the value), and a `src/instrumentation.ts` with a bare `await registerTelemetryForNextjs()` outside `try`/`catch` | Report that a missing optional `@opentelemetry/*` dependency now fails startup with `OtlpDependencyUnavailableError`; recommend running `yarn mercato telemetry init --dry-run` and then `yarn mercato telemetry init`, applying the printed snippet by hand when it reports `manual`; check Docker Compose `.env` values for an enabled backend |
| `sse-stream-api-key-consumers` | Detect and report | Non-browser clients of `GET /api/events/stream` that send `x-api-key` or `Authorization: ApiKey`, or that assume a stream never closes | Report that API-key callers now get `401` and every stream closes after `OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS` (±15%); require switching server consumers to webhooks and reconnecting non-browser clients |
| `empty-organization-scope-deny` | Detect and report | App code that widens an empty `filterIds`/`allowedIds` back to a home organization, or that resolves a single organization without `resolveSingleOrganizationIdOrDeny` / `isExplicitlyEmptyOrganizationScope` from `@open-mercato/shared/lib/auth/organizationScope` | Report that an explicitly empty scope now means deny-all everywhere; recommend the shared helpers and letting a thrown `CrudHttpError` propagate; remind operators that users seeing empty lists or `403` need organization visibility granted |
| `progress-api-organization-scope` | No code action | N/A — runtime behavior | Explain that `/api/progress/*` now follows the selected organization; users expecting other organizations' jobs should switch to **All organizations** |
| `route-identity-header` | Detect and report | App or client code that sets `x-open-mercato-route-identity`, or builds malformed percent-encoded API paths | Report that the header is internal — a forged value now returns `400` — and that a malformed percent escape returns `404` before the handler runs |
| `encryption-map-uniqueness-migration` | No code action | N/A — deployment ordering | Explain that `Migration20261004120000_encryption_map_scope_uniqueness` must run (`yarn db:migrate` or the deployment migration step) before the new version serves traffic; until then saving an encryption map fails |

## Workflow

### 1. Gate the target

Resolve `--path`, require a regular `package.json`, and confirm at least one dependency or development dependency starts with `@open-mercato/`. Refuse to run when the target has the framework monorepo signature, including its core and shared workspace packages.

Inspect installed and pinned Open Mercato versions. Continue when they resolve to `0.9.0`; otherwise warn with the detected versions and require explicit user confirmation before edits. A dry run may continue without confirmation.

Exclude `.git/`, `node_modules/`, `.yarn/`, `.next/`, `dist/`, `build/`, `coverage/`, `.mercato/generated/`, generated registries, vendor directories, and framework-owned packages from every scan. The single exception is `host-locale-overrides-module-keys`, which reads installed `@open-mercato/*` module dictionaries under `node_modules/` as a read-only reference and never edits them. Follow symlinks neither while scanning nor editing. Never print environment-variable values or other secret-bearing content.

### 2. Build and show the plan

Run every selected detection before editing. Report each match as `{checkId, file, line, classification, proposedAction}`. Distinguish exact automatic matches from detect-and-report candidates, and list every no-code-action reminder even when no file match applies.

For `customers-requires-progress`, an automatic match requires a regular `src/modules.ts` containing exactly one single-line object literal with `id: 'customers'` (or the double-quoted equivalent) and `from: '@open-mercato/core'`, and no `progress` module id anywhere in the file. A customers entry spread across lines, built conditionally, pushed at runtime, or loaded from another file is a detect-and-report candidate. If `progress` is already present but listed after `customers`, report it — order does not affect the generator check, so do not move it.

With `--dry-run`, print the complete plan, all no-code-action reminders, and unresolved manual work, then stop without edits, package-manager commands, generation, tests, or builds.

### 3. Apply bounded edits

Ask for confirmation of the displayed plan. Apply one minimal, idempotent edit per exact match:

- Insert `{ id: 'progress', from: '@open-mercato/core' },` on its own line immediately before the exact `customers` entry in `src/modules.ts`, copying that line's indentation, quote style, and trailing-comma convention.

Preserve file encoding, line endings, and unrelated formatting. Re-scan after editing: `src/modules.ts` must contain exactly one `progress` entry, while every manual candidate remains listed. Never perform repository-wide string replacement, and never run `yarn mercato telemetry init` without the user's explicit go-ahead (it can also edit `package.json` and `.env`).

### 4. Verify

Use the package manager and scripts declared by the downstream app; do not assume monorepo-only commands exist. Run, in order when present:

1. the configured generation script (this is what proves the `customers` → `progress` dependency is satisfied);
2. the configured typecheck script (this surfaces `ChannelScope` null-organization mismatches);
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
- unresolved operational work: granting the migrating role `CREATE` for `unaccent`/`pg_trgm` and migrating before deploying (catalog search and the encryption-map uniqueness index), `yarn mercato entities seed-encryption` for the new `ai_assistant` maps, the telemetry bootstrap refresh and optional-dependency check for an enabled OTLP backend, password resets after redoing a user create, re-parenting organization trees already flattened by the old `directory.organizations.update`, moving API-key SSE consumers to webhooks, and granting organization visibility to users with an empty scope.

If no code changes were required, still report that all twenty-five upgrade categories ran. Recommend reviewing the complete `0.8.0 → 0.9.0` section of `UPGRADE_NOTES.md` before deployment.

## Rules

- Every automatic edit must be exact, bounded, minimal, and idempotent.
- Never change dependency versions, lockfiles, generated output, vendor files, framework-owned packages, or secrets.
- Never rewrite a command's `buildLog`, a workflow definition, an organization-scope resolver, SQL search predicates, or an adapter's scope handling automatically — every such match in this window is intent-sensitive.
- Never delete a locale key or an encryption-map entry automatically — report the exact entries instead.
- Never display `TELEMETRY_BACKEND`, OTLP endpoint/header, or any other environment value; report only the variable name, file, and line.
- Never weaken typecheck, tests, or build to make the upgrade appear green.
- Always show the edit plan before mutation and the exact changed-file list afterward.
