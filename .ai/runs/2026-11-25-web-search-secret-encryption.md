# Execution plan — web-search adapter secrets stored in plaintext

Source doc: .ai/specs/enterprise/2026-07-11-agent-web-search-tool.md

## Goal

Web-search adapter API keys (SERP, Exa, Firecrawl, …) get encrypted at rest with the tenant DEK whenever tenant data encryption is enabled and KMS is healthy. Today they never are.

## Root cause

`packages/enterprise/src/modules/agent_orchestrator/lib/webSearch/secretStorage.ts` resolves the DI name `tenantDataEncryptionService`. Core bootstrap registers the service as `tenantEncryptionService` (`packages/core/src/bootstrap.ts:239`), and nothing registers the other name. The resolve throws, the catch returns `null`, `encryptAdapterSecrets` reports `encrypted: false`, and the key is persisted in plaintext. The unit tests mocked the same wrong name, so they stayed green. The settings PUT (`api/web-search/settings/route.ts:216`) and the read path (`lib/webSearch/policy.ts:237`) do not resolve the service themselves; both go through this helper. A repo-wide search found no other resolve of the wrong name.

Present since `ab4fc81f82` (2026-09-15), shipped in v0.8.0, v0.9.0 and v0.10.0.

## Scope

- Resolve `tenantEncryptionService`.
- On save, provision the tenant DEK when it is missing (`getDek ?? createDek`, as `customEntityDoc` does). Reads and the pre-save `canEncryptSecrets` preview never provision (#5950).
- Regression tests that wire the real `TenantDataEncryptionService` under the bootstrap DI name: the stored secret is an `iv:ct:tag:v1` envelope, a legacy plaintext key reads back and is re-sealed on the next save, and the DEK is provisioned on save only.
- One changelog line in the web-search spec.

## Non-goals

- No data migration. Existing plaintext rows are re-sealed on the next settings save, since the PUT re-encrypts every adapter's options.
- No change to the settings UI, the warning copy, the API response shape, or PR #9438's credential-retarget work.
- No hand-rolled crypto. DEKs come from `TenantDataEncryptionService`, and sealing uses the shared `encryptWithAesGcm` / `decryptWithAesGcm`.

## Implementation Plan

### Phase 1: Fix and regression tests

1.1 Resolve the registered DI name, provision the DEK on first save, and add real-service regression tests.

### Phase 2: Spec and validation

2.1 Record the fix in the web-search spec changelog.
2.2 Run the full validation gate.

## Risks

- Low. One DI name, plus a `createDek` fallback that only runs when encryption is enabled and the tenant has no DEK. Tenants normally get one when they are created (`directory/commands/tenants.ts:77`).
- Backups taken before this ships still hold plaintext keys. Operators who shared such dumps should rotate the adapter keys. That is called out in the PR, not fixed in code.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and regression tests

- [x] 1.1 Resolve the registered DI name, provision the DEK on first save, and add real-service regression tests — 6d757e7a22

### Phase 2: Spec and validation

- [x] 2.1 Record the fix in the web-search spec changelog — 9494a0fff9
- [ ] 2.2 Run the full validation gate
