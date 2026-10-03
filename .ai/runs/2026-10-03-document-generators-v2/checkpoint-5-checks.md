🤖 `om-auto-continue-pr-loop` — checkpoint 5 verification

Steps 5.1–5.5 plus 5.1-review-fix (23ae21dca through 05cf126d8) complete. Runner: local. Touched areas: engine API helpers/validators, organization scope resolution, catalogue/options/preview routes, `GeneratedDocument` entity + encryption map + migration, generation history service.

| Check | Result |
|---|---|
| document-generators package Jest | ✅ 18 suites / 133 tests |
| Sales document-generators Jest + module-decoupling | ✅ 6 suites / 63 tests |
| document-generators typecheck + build | ✅ |
| `yarn generate` | ✅ routes `/document-generators/{templates,templates/options,preview}` in the API manifest; `document_generators:generated_document` entity id and `document_generators/encryption` discovered like other module encryption maps |
| `yarn i18n:check-sync` | ✅ |
| Migration review | ✅ `document_generators_generated_documents` with spec columns/defaults, indexes `(organization_id, resource_kind, resource_id)` and `(tenant_id, organization_id, generated_at desc)`, `down()` drops the table; produced by `yarn db:generate` against a throwaway Docker Postgres (unrelated WMS output discarded); no `db:migrate` anywhere |
| UI / browser verification | ⏭ skipped — no UI touched in this window |

Review notes:
- 5.1-review-fix: `getAuthFromRequest` applies the organization-switcher cookie only for super-admins, so `requireOrganization` now resolves the selected organization through the Directory `organizationScopeService` (shared contract, no core dependency), refuses rejected selections and projects the selected organization onto the auth used for RBAC and source fetching.
- 5.5 landed as two commits (an executor tooling slip); history was not rewritten.
- History writes fail closed: `prepare` encrypts `resource_label` explicitly (or throws when encryption is toggled on but unavailable) before the route's best-effort section; the flush subscriber skips values already sealed under the current DEK.
- `new GenerationHistoryService(em)` per request is the spec's constructor exception — explicit sign-off still required at Step 10.3.
