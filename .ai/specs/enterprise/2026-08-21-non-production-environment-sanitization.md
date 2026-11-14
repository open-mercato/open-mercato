# Non-production environment sanitization

## TL;DR

The Enterprise `data_erasure` module adds a controlled post-restore workflow for preparing copied data for a sandbox. It refuses to mutate a production or unclassified environment, runs all registered module sanitizers, verifies the result, stores an operation report, and exposes the same workflow through an authenticated API and an operator CLI command.

## Problem

A database restore alone can copy personal data, active credentials, outbound integrations, attachments, and AI content into a less controlled environment. Operators need one repeatable command that converts the restored copy into a safe non-production dataset and produces evidence that the expected controls were applied.

## Solution

Add `PrivacyGovernanceService.runEnvironmentSanitization`. The workflow:

1. requires an explicit `OM_ENVIRONMENT_CLASSIFICATION` value;
2. refuses `production` and unknown values before performing any mutation;
3. creates a `sanitization` privacy operation;
4. discovers all data classes with environment sanitization support;
5. runs each module handler under the selected tenant and organization scope;
6. runs every handler's verification phase;
7. marks the operation `completed`, `partial`, or `failed` and stores count-only evidence.

The supported classifications are `production`, `staging`, `sandbox`, `test`, and `development`. Apply mode is allowed only for the four non-production values. Dry-run and verification still require an explicit classification so an operator cannot mistake an unclassified deployment for a sandbox.

## Product boundary

- MIT Core owns generic contracts and module-local sanitization logic.
- Enterprise owns the cross-module workflow, safety gate, operation record, API, and CLI.
- Backup creation, encrypted transport, and database restore remain operator responsibilities. The supported sequence is restore into an isolated destination, set its explicit classification, run sanitization, and admit users only after verification passes.

## API

`POST /api/data_erasure/environment-sanitization`

Request:

```json
{
  "dryRun": true,
  "profile": "sandbox-strict",
  "confirmation": null
}
```

Apply mode requires `confirmation: "SANITIZE_NON_PRODUCTION"`. The route requires `data_erasure.manage` and participates in mutation guards.

The response contains the serialized privacy operation. Reports contain handler status, matched and affected counts, verification findings, and the environment classification. They never contain copied source values.

## CLI

```bash
yarn mercato data_erasure sanitize-environment \
  --tenant <id> \
  --organization <id> \
  --actor <user-id> \
  --apply \
  --confirm SANITIZE_NON_PRODUCTION
```

Without `--apply`, the command runs a dry-run and verification report.

## Failure semantics

- Missing or invalid classification: reject before creating an operation.
- `production`: reject before creating an operation.
- Missing handler method: mark that class failed.
- Sanitizer error: continue with later classes and mark the operation partial or failed.
- Verification finding after apply: mark that class failed and the operation partial or failed.
- Dry-run findings describe current unsafe data and do not make the dry-run itself fail.

## Integration coverage

- API dry-run returns a count-only report.
- API apply requires the confirmation token.
- Production and unclassified environments reject apply before invoking handlers.
- A verification finding prevents an applied operation from completing successfully.
- CLI and API call the same governance service.

## Migration and backward compatibility

`PrivacyOperation.type` is stored as text, so adding the `sanitization` type requires no database migration. Existing operation rows and list filters remain valid. The new API and CLI command are additive.

## Implementation status

- [x] Environment classification gate
- [x] Governance orchestration and report
- [x] API route and validation
- [x] CLI command
- [x] Unit and integration coverage

## Changelog

- 2026-08-21: Initial Enterprise implementation specification for OM-SEC-011.
