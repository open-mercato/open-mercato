# Integration Secret Credential Editing

## TLDR

The integration and bundle credential forms will treat stored secret credentials as write-only values: configured secret fields render empty, explain that a value already exists, and only submit a replacement when the operator types one. The UI sends an additive list of intentionally unchanged secret field names so the server can preserve them without changing the existing full-blob replacement contract or exposing the sentinel as editable form state.

Scope is limited to the two core-owned generic `integrations` credential editors and credentials merge behavior described in [issue #5421](https://github.com/open-mercato/open-mercato/issues/5421). It does not change credential storage, encryption, registry types, route URLs, ACLs, database schema, or provider-specific logic.

## Problem Statement

`GET /api/integrations/:id/credentials` replaces configured secrets with the internal `__om_secret_unchanged__` sentinel and separately returns `secretFieldsConfigured`. The integration detail page currently passes the response object directly to `CrudForm`, so `PasswordInput` receives the sentinel as editable text. Partial edits can therefore persist a hybrid sentinel/user value, while a reload hides the corruption behind a fresh sentinel.

## Proposed Solution

- Consume `secretFieldsConfigured` when loading the integration detail form.
- Remove configured secret values from `CrudForm.initialValues` so `PasswordInput` is genuinely empty and never exposes the sentinel as a field value.
- Apply the same write-only state to the bundle credentials editor, which currently copies the masked response into a password input through a duplicate path.
- Show an i18n-backed configured-state hint telling the operator that typing replaces the saved secret.
- Let a required secret validate as satisfied when the server says it is already configured and the replacement input is empty.
- Omit empty, already-configured secret values from the credentials object and list their field names under a new optional `unchangedSecretFields` request property; continue sending non-secret values and newly typed replacements.
- Extend the server merge helper so only explicitly listed omitted secret keys are preserved. A plain omitted key keeps the existing full-blob replacement/clear semantics, explicit empty strings still clear, and sentinel submissions remain backward compatible.
- Add regression coverage for initial rendering, untouched saves, replacements, explicit clears, and API compatibility.

## Overview

This is a core correction to the generic integrations credential editors. Every provider that declares a credential field with `type: 'secret'` uses the integration detail page or bundle page, so provider-specific extensions cannot repair the common initial-value and submission behavior. The existing `CrudForm`, `PasswordInput`, `apiCall`, `useGuardedMutation`, optimistic-lock header, credentials encryption service, and tenant/organization scope remain authoritative. The bundle page keeps its existing custom host in this narrowly scoped fix but uses the DS `PasswordInput` for its touched secret control.

The implementation intentionally separates two concepts that the current form conflates:

1. **Configured state** — server-owned metadata in `secretFieldsConfigured` indicating that encrypted storage contains a value.
2. **Replacement input** — a new, initially empty browser value that exists only when the operator types it.

This matches the established write-only-secret UX while avoiding the placeholder failure mode reported in another major open-source automation platform: n8n users have repeatedly seen its internal blank-value sentinel in editable credential fields and interpreted resulting saves as data loss or failed persistence ([n8n issue #30846](https://github.com/n8n-io/n8n/issues/30846)). Open Mercato adopts the useful write-only boundary but rejects an editable sentinel as UI state.

## Acceptance Criteria

1. Loading an integration whose secret is configured renders the corresponding `PasswordInput` empty.
2. The literal `__om_secret_unchanged__` does not appear in the rendered form or become the input's controlled value, including after using the reveal toggle.
3. A configured secret field shows localized guidance equivalent to “Configured. Enter a new value to replace it.”
4. On the direct detail page, a required configured secret passes form validation when its replacement input is empty.
5. Saving without editing a configured secret omits that key from the PUT credentials object, includes its name in `unchangedSecretFields`, and preserves the encrypted stored value.
6. Typing a replacement submits that exact value and persists it through the existing encrypted credential service.
7. A legacy request with `{ credentials: {} }` still clears all credentials, an explicit `""` still clears its secret, and an existing client that submits the sentinel still preserves it.
8. First-time configuration remains unchanged: on the direct detail page an unconfigured required secret starts empty, remains required, and is submitted when entered.
9. Non-secret fields, guarded mutation hooks, optimistic locking, events, authorization, and tenant/organization scoping remain unchanged. Switching `storage_s3` to ambient authentication still explicitly clears access-key secrets instead of having omission preserve them.
10. Direct detail and bundle credential editors both satisfy criteria 1–3 and 5–6; the direct page also satisfies criterion 4 through its existing Zod/CrudForm validation.
11. Unit, route, jsdom UI, and module-local Playwright coverage exercise the changed API and UI paths.

## Architecture

### Extension Mode

**Core modification.** The defect is in the core-owned generic integration detail/bundle pages and credentials PUT merge contract. A UMES widget cannot safely replace the common initial values, required-field validation, or server merge behavior for every provider. The change stays inside `packages/core/src/modules/integrations/` and introduces no provider-specific branch.

### Data Flow

1. The existing GET route decrypts credentials through `integrationCredentialsService`, masks secret values, and returns `secretFieldsConfigured` plus `updatedAt`.
2. The direct detail page keeps the raw masked credentials map unchanged for the FROZEN `integrations.detail.v1` widget context and derives separate form initial values with configured secret keys removed. The bundle page, which has no equivalent credential widget context, stores the sanitized edit values directly.
3. Both editors store the configured-state map and use it to add localized guidance; touched secret controls use the existing DS `PasswordInput` primitive.
4. Direct-detail Zod validation treats an empty configured `secret` replacement as satisfied, but still rejects an empty required secret when the map reports `false`.
5. A shared submission helper removes empty configured secret values and returns their names in `unchangedSecretFields` before the existing guarded PUT. A deliberate clear path such as `storage_s3` ambient authentication removes those names from the unchanged list, retaining the current full-replacement clear behavior.
6. `saveCredentialsSchema` accepts the new optional, bounded field-name list. `mergeMaskedSecretCredentials` preserves a missing value only when its name is listed and the schema declares it secret; explicit submitted values win over the list. Exact sentinel preservation remains for legacy clients.
7. The existing save service encrypts and persists the merged full object, emits the same event, and returns the same response.

### Relevant Architecture Rules

- §4: keep the change within the owning `integrations` module; no cross-module imports or provider special cases.
- §§7–8: preserve the custom route's Zod boundary, metadata/OpenAPI, mutation guards, and trusted scope.
- §10: retain `CrudForm`, `PasswordInput`, `apiCall`, `useGuardedMutation`, and optimistic-lock handling.
- §§14–16: preserve feature guards, tenant/organization scope, encrypted reads, and the write-only secret boundary.
- §22: use existing DS primitives, semantic classes, and localized copy.
- §27: add behavior without renaming/removing stable routes, response keys, function parameters, or other contract surfaces.
- §31: apply the full code-review checklist, especially C, E, H, I, L, N, and O.

### Frontend Architecture Contract

#### Server/Client Boundary Map

| Route / surface | Server root | Client island | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/backend/integrations/:id` | Existing module catch-all | Existing `backend/integrations/[id]/page.tsx` | `/api/integrations/:id` and `/api/integrations/:id/credentials` | No new provider or global bootstrap; the existing page is already a client component. |
| `/backend/integrations/bundle/:id` | Existing module catch-all | Existing `backend/integrations/bundle/[id]/page.tsx` | Same detail/credentials APIs for the bundle id | Duplicate credential editor is fixed under the same contract. |

#### `"use client"` Ledger

| File | Reason | Imported by | Heavy deps | Risk / alternative |
| --- | --- | --- | --- | --- |
| `packages/core/src/modules/integrations/backend/integrations/[id]/page.tsx` | Existing stateful `CrudForm`, API loading, revealable password input, tabs, and guarded mutations | Module route registry | No new dependency | The file already exceeds 300 lines. This fix adds only localized state/plumbing; decomposing the legacy page is a separate refactor with much larger regression risk. Pure transformations should be extracted only when doing so materially improves testability. |
| `packages/core/src/modules/integrations/backend/integrations/bundle/[id]/page.tsx` | Existing stateful bundle credentials/toggles editor | Module route registry | No new dependency | Keep the existing host, replace only the touched secret control with `PasswordInput`, and preserve guarded writes. |

#### Budgets and Evidence

| Budget | Target |
| --- | --- |
| New page-root client components | 0 |
| New heavy browser dependencies | 0 |
| New global providers/bootstrap imports | 0 |
| New arbitrary DS values/raw controls | 0 |
| Hydration/interactivity | Module-local Playwright route load plus password edit/save assertions |
| Static/build evidence | `yarn check:client-boundaries` when returned by `required-checks`; configured build/type/test gates |

## Data Models

No entity, migration, index, encryption-map, or database-column change. `IntegrationCredentials.credentials` remains encrypted at rest through the current module encryption map and credential service.

Existing values corrupted before this fix cannot be identified reliably: a legitimate secret and a partially edited sentinel are both arbitrary encrypted strings. The safe remediation is explicit replacement by an operator; automatic pattern deletion could destroy valid credentials. The configured-state hint makes that replacement path clear, while health checks continue to expose authentication failures.

## API Contracts

### `GET /api/integrations/:id/credentials`

No URL, method, guard, response-key, or widget-context value change.

Relevant response shape remains:

```json
{
  "credentials": {
    "nonSecretField": "value",
    "configuredSecret": "__om_secret_unchanged__"
  },
  "secretFieldsConfigured": {
    "configuredSecret": true
  },
  "updatedAt": "2026-08-21T12:00:00.000Z"
}
```

The first-party form treats the sentinel as transport compatibility data and strips it before form initialization. This preserves existing API clients that round-trip the sentinel while eliminating the editable-placeholder defect.

### `PUT /api/integrations/:id/credentials`

Request URL, method, authorization, mutation guards, optimistic-lock header, response, and default full-blob replacement behavior remain stable. The request adds one optional property:

```json
{
  "credentials": {
    "nonSecretField": "value"
  },
  "unchangedSecretFields": ["configuredSecret"]
}
```

`unchangedSecretFields` is bounded to at most 200 non-empty field names of at most 128 characters, matching the credentials record limits. Only names declared by the provider schema as secret-bearing are eligible for preservation; unknown or non-secret names do not retain data. An explicitly submitted credential value takes precedence over the list.

Update `apps/docs/docs/api/integrations-data-sync.mdx` to document masked/write-only GET values, `secretFieldsConfigured`, the optional unchanged-field intent, full-replacement/default clear behavior, and the route's actual `integrations.credentials.manage` feature requirement.

Secret merge semantics become:

| Incoming secret key | Existing value | Result |
| --- | --- | --- |
| Omitted, name explicitly listed unchanged | Present | Preserve existing |
| Exact sentinel | Present | Preserve existing (legacy compatibility) |
| Omitted, not listed | Any | Remove through the existing full-blob replacement behavior |
| Listed or sentinel | Absent | Keep absent |
| Non-empty string | Any | Replace with submitted value |
| Empty string | Any | Explicitly clear, preserving current API semantics |

Failure behavior remains fail-closed: invalid payloads return `422`, stale optimistic locks return `409`, unavailable encryption returns `503`, missing scope/auth returns the existing `401`/organization-scope response, and unexpected failures do not persist a partial credential object.

## Permissions and Data Boundaries

- GET and PUT remain guarded by `integrations.credentials.manage` and authenticated tenant context.
- Organization scope continues to come from `resolveActiveOrganizationId(auth)`, never the request body.
- Existing credentials are resolved and saved with `{ tenantId, organizationId }` through the DI credential service.
- Plaintext stored secrets never enter the response, form initial state, logs, errors, review artifacts, or test snapshots.
- The UI's configured-state map contains booleans only and is not a secret oracle beyond the already-authorized credential-management page.
- The unchanged list carries provider-declared field names only, never values, and the server intersects it with the trusted schema before preservation.

## UI/UX and Internationalization

- Reuse the existing direct-detail `CrudForm` and custom `PasswordInput` field renderer; migrate the touched bundle secret control from generic `Input type="password"` to `PasswordInput`.
- Set credential replacement inputs to `autoComplete="new-password"` so password managers do not refill stored-account passwords into provider secret fields.
- Configured secret inputs remain empty even after reveal; the reveal control only reveals newly entered replacement text.
- Add one `integrations.detail.credentials.secretConfigured` key to every shipped locale (`de`, `en`, `es`, `ko`, `pl`).
- Render the hint as standard secondary form description text through the existing `CrudField.description` surface; do not introduce a custom alert, color, icon, or raw control.
- Preserve provider help text/setup guidance and append the configured-state hint without replacing it.
- Preserve `storage_s3` ambient-mode cleanup by translating its deliberate secret removal into the API's existing explicit-empty clear representation before generic untouched-secret omission runs.
- Preserve `Cmd/Ctrl+Enter`, `Escape`, dirty-state tracking, `FormHeader`, and the page-level guarded mutation path provided by the existing host.

## Migration, Rollout, and Backward Compatibility

No migration or feature flag is required. The fix is deployable independently and takes effect on the next form load.

| Contract surface | Effect |
| --- | --- |
| Auto-discovery files/exports | None |
| Public types/interfaces | `SaveCredentialsInput` gains one optional field only |
| Function signatures | `mergeMaskedSecretCredentials` gains a trailing optional unchanged-field list; existing calls compile and behave unchanged |
| Import paths | None |
| Event IDs/payloads | None |
| Widget spots/replacement handles | None |
| API routes/methods/response keys | None |
| Database schema | None |
| DI service names | None |
| ACL feature IDs | None |
| Notification IDs | None |
| CLI commands | None |
| Generated file contracts | None |

The default GET sentinel stays available for existing clients and the existing detail widget context keeps receiving the same raw masked map. PUT continues accepting exact sentinel submissions, explicit empty-string clears, and `{ credentials: {} }` clear-all requests. A missing secret is preserved only when the caller opts into the additive `unchangedSecretFields` intent, so existing clients require no migration and keep byte-for-byte default behavior.

## Testing Strategy

### Unit and Route Tests

- `credentials-masking.test.ts`
  - listed omitted `secret`, `oauth`, and `ssh_keypair` values preserve stored values;
  - unlisted omission keeps full-blob removal behavior;
  - unknown/non-secret unchanged names do not preserve values;
  - sentinel compatibility, replacement, explicit clear, and non-secret behavior remain covered.
- `validators.test.ts`
  - accepts a bounded optional unchanged list and rejects excessive/invalid names.
- `credentials-route.test.ts`
  - PUT with a listed omitted configured secret saves the stored value;
  - PUT with plain omission/empty credentials keeps clear behavior;
  - existing GET masking and PUT sentinel/replacement/explicit-clear cases remain green.

### UI Regression Test

Add a jsdom page test that mocks the authorized detail/credentials APIs and proves:

- configured secret response mounts an empty `PasswordInput`;
- the sentinel is absent from the DOM and reveal does not expose it;
- the configured hint is visible;
- untouched submit omits the secret key;
- typed replacement is present in the subsequent PUT body;
- an unconfigured required secret still validates as required.

Add equivalent focused coverage for the bundle page's empty secret input, configured hint, unchanged list, and replacement payload. Shared pure helper tests cover both hosts' value/payload transformations without duplicating assertions.

### Module-Local Playwright Test

Add a self-contained test under `packages/core/src/modules/integrations/__integration__/` after live selector discovery. It asserts route hydration, empty configured secret input, configured hint, untouched save with the unchanged-field list, and replacement save. Prefer deterministic API interception or a disposable isolated fixture over mutating/restoring an existing masked credential row, because a GET response cannot recover prior plaintext. Use `domcontentloaded` plus explicit input/button readiness rather than `networkidle` because backend pages may keep long-lived streams.

Update existing integration-test assertions/comments whose current full-replacement or “decrypted verbatim” descriptions would become inaccurate. The clear-all test must continue proving `{ credentials: {} }` clears schema-declared secrets unless an unchanged list is explicitly sent.

### Validation

Run the focused core Jest suites, the new Playwright spec, all commands returned by harness `required-checks`, and the configured ordered gate. UI review also runs the DS guardian and local QA workflow without staging their artifacts.

## Implementation Plan

### Phase 1 — Additive Server Intent

1. Add the optional bounded `unchangedSecretFields` request field and pass it through mutation-guard reparsing.
2. Extend `mergeMaskedSecretCredentials` with a trailing optional list while preserving default full-blob behavior.
3. Extend validator/helper/route/integration tests for listed omission, plain omission, sentinel, replacement, explicit clear, and clear-all behavior.
4. Correct the public credentials API documentation and stale test contract prose.

### Phase 2 — Write-Only Form State

1. Add shared pure helpers for sanitized edit values and `{ credentials, unchangedSecretFields }` submission intent.
2. Consume and store `secretFieldsConfigured` in both credential editors.
3. Preserve the direct page's raw masked `credentialValues` widget context while giving `CrudForm` separate sanitized initial values.
4. Append the localized configured hint and make direct-page required validation aware of configured secrets.
5. Preserve provider-specific normalization; exclude deliberate `storage_s3` ambient clears from the unchanged list.
6. Migrate the touched bundle secret control to `PasswordInput` and use the shared submission contract.
7. Add locale keys and focused helper/jsdom coverage for both hosts.

### Phase 3 — Integration Evidence and Review

1. Add the module-local Playwright regression using deterministic API interception.
2. Run focused tests, DS checks, full required validation, and exact-diff independent review.
3. Update implementation status and changelog before the final packet.

## Risks & Impact Review

### Existing Corrupted Credentials Remain Stored

- **Scenario**: A credential was already saved as a hybrid sentinel/user string before deployment.
- **Severity**: High
- **Affected area**: Any integration using a generic `secret` field.
- **Mitigation**: The fixed UI provides an explicit empty replacement input and configured-state guidance; provider health checks reveal authentication failures and operators can replace the value normally.
- **Residual risk**: The server cannot distinguish a corrupted hybrid from a legitimate arbitrary secret without false positives, so no automatic destructive cleanup is safe.

### Unchanged Intent Is Forged for a Non-Secret Field

- **Scenario**: A caller lists an unknown or non-secret field in `unchangedSecretFields` to retain data it omitted from the full replacement.
- **Severity**: Medium
- **Affected area**: Credentials PUT merge behavior.
- **Mitigation**: Bound the list in Zod and intersect it with trusted provider schema secret types; explicit submitted values always win.
- **Residual risk**: Invalid names may be ignored rather than rejected semantically, but they cannot retain non-secret or undeclared data.

### Required Validation Accepts an Actually Missing Secret

- **Scenario**: Client form state incorrectly marks an absent secret as configured.
- **Severity**: Medium
- **Affected area**: Credential form validation.
- **Mitigation**: The boolean map comes from the authorized server response after inspecting stored encrypted data; first-time `false` stays required. UI and route tests cover both states.
- **Residual risk**: A stale response can race another writer, but existing optimistic locking rejects stale saves.

### Secret Sentinel Re-enters the Form During Reload

- **Scenario**: A refresh path bypasses the sanitizer and remounts the raw GET object.
- **Severity**: High
- **Affected area**: Integration detail credential editing.
- **Mitigation**: Centralize all credential reloads through `loadCredentials`, and cover initial load plus post-save reload in UI/browser tests.
- **Residual risk**: A future separate form implementation could repeat the mistake; the spec and tests document the canonical configured-state contract.

### Frontend Page Regression

- **Scenario**: Extra state/description composition disrupts a provider's existing help text, conditional visibility, or `storage_s3` normalization.
- **Severity**: Medium
- **Affected area**: Generic integration detail page.
- **Mitigation**: Preserve the existing field builder and submit sequence, append rather than replace descriptions, and regression-test non-secret payloads alongside secret behavior.
- **Residual risk**: Provider-specific combinations remain broader than one synthetic browser fixture; full core tests and configured build gate cover type/runtime integration.

### Deliberate Secret Clearing Is Misclassified as Untouched

- **Scenario**: A provider flow intentionally removes a secret by omitting its key, but the new server merge preserves it.
- **Severity**: High
- **Affected area**: `storage_s3` switching from access keys to ambient credentials and any future deliberate clear flow.
- **Mitigation**: Preserve only fields explicitly listed unchanged. Deliberate clear paths omit the value without listing it (or send an explicit empty string); cover the `storage_s3` branch in the UI regression suite.
- **Residual risk**: Future provider-specific clear flows must not accidentally add their field to the unchanged list, which is documented in the merge table and helper tests.

## Final Compliance Report — 2026-08-21

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `omdyo-general/architecture/ARCHITECTURE.md` relevant sections and complete §31

### Compliance Matrix

| Rule source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root/core integrations | Secrets remain encrypted, scoped, and never logged | Compliant | Existing credential service and scope are unchanged; form receives no plaintext. |
| Root/core API | Auth, organization scope, mutation guards, OpenAPI, optimistic locking | Compliant | Existing custom route path remains intact. |
| UI/backend | Use `CrudForm`, `PasswordInput`, `apiCall`, and guarded mutation | Compliant | No new form host, raw fetch, or raw input. |
| DS/i18n | Existing primitive, semantic classes, all locales | Compliant | One secondary description; no new color or arbitrary value. |
| Backward compatibility | No removal/rename/narrowing | Compliant | Sentinel, plain omission/full replacement, clear-all, and explicit clear remain supported; new intent is optional/additive. |
| Testing | API and key UI paths have integration coverage | Compliant | Route/Jest/jsdom/Playwright plan is explicit and self-contained. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data model matches API | Pass | No model change; merge semantics operate on the existing encrypted record. |
| API matches UI | Pass | Configured map drives empty input, validation, hint, and explicit unchanged intent. |
| Risks cover writes | Pass | Omission, stale state, existing corruption, and reload paths covered. |
| Commands/events | N/A | Existing custom credentials service/event flow is preserved. |
| Cache/search | N/A | Credential data is not introduced into cache or search. |

### Verdict

**Fully compliant — pre-implementation audit passed; ready for implementation.**

## Implementation Status

| Phase | Status | Date | Notes |
| --- | --- | --- | --- |
| Phase 1 — Additive Server Intent | Done | 2026-08-21 | Optional intent, merge semantics, and 27 focused validator/helper/route tests pass. |
| Phase 2 — Write-Only Form State | Done | 2026-08-21 | Both editors, locale/docs, helper/jsdom coverage, and live browser regression pass. |
| Phase 3 — Integration Evidence and Review | In Progress | 2026-08-21 | Automated implementation, browser evidence, and full local gates complete; human review and publication pending. |

### Phase 1 — Detailed Progress

- [x] Add bounded `unchangedSecretFields` request validation.
- [x] Preserve only explicitly listed omitted schema-secret fields.
- [x] Retain sentinel, replacement, explicit-empty, plain-omission, and full-replacement behavior.
- [x] Pass focused validator/helper/route regression tests.

### Phase 2 — Detailed Progress

- [x] Keep raw masked direct-page widget context while deriving empty form values.
- [x] Add shared edit/save transformations and explicit unchanged-field intent.
- [x] Fix direct and bundle editors, configured hints, required validation, autocomplete, and S3 ambient clears.
- [x] Update five locales and public API documentation.
- [x] Pass 35 focused Jest tests across both hosts and the server path.
- [x] Observe the live Stripe page and pass `TC-INT-011` in Chromium.

### Phase 3 — Detailed Progress

- [x] Rebase the implementation onto current `develop` in an isolated staged-only worktree.
- [x] Capture a regression test failing because the secret input contained `__om_secret_unchanged__`.
- [x] Pass the configured build, generation, translation, typecheck, unit-test, and app-build gates.
- [x] Pass lesson-catalog and design-system checks without new violations.
- [x] Pass the current-diff `TC-INT-011` Playwright regression in an isolated ephemeral environment.
- [ ] Complete human review and publication.

## Changelog

### 2026-08-21

- Added the initial specification for issue #5421.
- Completed architecture, compatibility, security, frontend-boundary, risk, and test planning.
- Revised the design after the readiness audit to preserve full-blob replacement, the clear-all contract, and the raw masked widget context; added bundle-editor coverage.
- Passed the pre-implementation analysis in `analysis/ANALYSIS-2026-08-21-integration-secret-credential-editing.md` with no remaining blockers.
- Completed the current-`develop` implementation with 35 focused Jest tests, the full configured local gate, and the `TC-INT-011` Chromium regression passing.
