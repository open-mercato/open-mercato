# Non-production sanitization contract

## TL;DR

Open Mercato modules can declare how their own tenant-scoped data is sanitized and verified after a production backup is restored into a non-production environment. The shared contract and module-owned handlers remain MIT. Execution, reporting, and the production safety gate are implemented by the Enterprise `data_erasure` module.

## Problem

The platform has subject-level anonymization and retention handlers, but it has no common contract for preparing a restored database for use in a sandbox. A safe workflow must cover personal data, authentication material, integration credentials, outbound integrations, attachments, and AI content without giving one module direct knowledge of every other module's tables.

## Solution

Extend the additive privacy data-class contract with optional environment sanitization metadata and two optional handler methods:

- `sanitizeEnvironment` removes or masks data owned by the module;
- `verifyEnvironmentSanitization` checks that the module's unsafe values are absent.

Each result contains counts only. It must never return source values, credentials, message bodies, file paths, or other copied content.

## Architecture

### MIT Core

- `@open-mercato/shared/lib/privacy` owns the additive types.
- `auth` invalidates local passwords, sessions, and reset tokens, and replaces user contact data with deterministic invalid addresses.
- `customers` masks people and removes their directly attached personal content.
- `integrations` deletes stored credentials and forces all registered integrations into a disabled, reauthorization-required state.
- `attachments` deletes scoped attachment rows and their stored objects.
- `ai_assistant` deletes scoped conversations, messages, pending actions, and prompt content while retaining non-content usage counters.

### Enterprise

The `data_erasure` module discovers every registered data class that declares environment sanitization and runs it. The orchestration contract is described in `.ai/specs/enterprise/2026-08-21-non-production-environment-sanitization.md`.

## Contract

Sanitization categories are additive string literals:

- `personal_data`
- `authentication`
- `credentials`
- `outbound_integrations`
- `attachments`
- `ai_content`

A handler returns `{ matched, affected }`. Verification returns `{ passed, findings }`, where every finding contains a stable code and count. A handler that declares sanitization support must implement both methods.

## Security and scope

- Every read and mutation is filtered by `tenantId` and `organizationId`.
- Verification returns counts and stable codes only.
- Credential rows are deleted without decrypting or logging their values.
- Attachment storage deletion uses the registered storage driver for the scoped partition.
- The contract itself does not decide whether the current deployment is safe to modify. The Enterprise orchestrator owns that fail-closed decision.

## Integration coverage

- Shared registry tests reject incomplete sanitization declarations.
- Module handler tests cover dry-run, mutation, and verification behavior.
- Enterprise integration coverage exercises the API workflow and confirms a production classification cannot apply changes.

## Migration and backward compatibility

The privacy contract change is additive. Existing data classes and handlers remain valid. No existing API route, event, ACL feature, or database column changes.

## Implementation status

- [x] Shared contract and registry validation
- [x] Auth and customer sanitizers
- [x] Integration, API key, attachment, and search-index sanitizers
- [x] AI Assistant content sanitizer
- [x] Unit coverage

## Changelog

- 2026-08-21: Initial implementation specification for OM-SEC-011.
