# EU-Hosted Transactional Email Provider Connectors

## TLDR

Add Brevo and Mailjet as independent, outbound-only `communication_channels` provider packages for system transactional email. Both providers publish European database-hosting information and DPA material, giving EEA operators alternatives to Resend while preserving the existing `sendEmail()` API, Communications Hub routing, Resend default, and SES support.

The integrations expose provider capabilities and configuration; they do not certify that an operator's deployment is GDPR-compliant. Operators remain responsible for their DPA, subprocessor, retention, lawful-basis, tracking, and transfer assessments.

## Resolved assumptions (autonomous defaults)

| Decision | Default used | Rationale |
| --- | --- | --- |
| Provider selection | Brevo and Mailjet | Both publish European hosting information, DPA material, mature transactional APIs, attachment and Reply-To support, and non-sending account endpoints suitable for health checks. Their contracts and subprocessors can still involve international processing. |
| Scope grouping | One spec and implementation PR, two independent packages | Maintainer exception: the user explicitly requested at least two connectors in one PR. Each package has an independent acceptance gate, release surface, and rollback path; neither provider may depend on the other. |
| HTTP integration | Provider-local `fetch` clients with shared timeout utilities; no new SDK dependencies | Both APIs are small, stable HTTP surfaces. This avoids adding production dependencies while keeping provider code isolated. |
| Delivery status | Return `sent` when the provider accepts the request | The existing synchronous system-email contract reports provider acceptance, not eventual delivery. Webhook delivery receipts remain out of scope. |
| Data-residency wording | “EU database hosting/GDPR-oriented,” never “EU-only” or “makes Open Mercato GDPR-compliant” | Compliance and international-transfer posture depend on operator contracts, subprocessors, and processing choices beyond connector code. |
| Existing defaults | Resend remains the default when `SYSTEM_EMAIL_PROVIDER` is unset | Changing the default would break existing deployments. |

## Problem Statement

Open Mercato now routes transactional email through the Communications Hub, but the built-in system-email providers are Resend and Amazon SES. Operators whose procurement or data-governance policy favors a European provider with published European database-hosting terms still need to build and maintain their own adapter.

Issue #5556 originally described the older Resend-only implementation. PR #4471 removed that architectural blocker by preserving `sendEmail()` and introducing provider packages. The remaining gap is provider coverage: two European transactional-email integrations that plug into the existing registry, tenant credential storage, env preconfiguration, and system-email selection flow.

## Proposed Solution

Create two additive workspace packages:

- `@open-mercato/channel-brevo`, module `channel_brevo`, provider key `brevo`.
- `@open-mercato/channel-mailjet`, module `channel_mailjet`, provider key `mailjet`.

Each package owns:

- integration metadata and encrypted credential schema;
- an outbound-only email `ChannelAdapter`;
- a provider-local HTTP client;
- a non-sending account health check;
- `SYSTEM_EMAIL_PROVIDER` env resolution and tenant preset seeding;
- a provider-local, rerunnable `configure-from-env` CLI for existing tenants;
- localized ACL metadata, capabilities, DI/setup registration, and focused tests.

The packages mirror `channel_resend` and `channel_ses`. No provider-specific branch is added to `shared`, `core`, or existing email call sites.

Scaleway Transactional Email is a follow-up candidate. It offers a Paris-only service and a strong European sovereignty posture, but its REST API is currently `v1alpha1` and the API path limits an entire message to 2 MB, so it is not one of the first two connectors.

## Architecture

```text
existing callers
    -> @open-mercato/shared sendEmail()
    -> communication_channels system-email transport
    -> selected tenant-wide ChannelAdapter
       -> channel_brevo  -> Brevo HTTPS API
       -> channel_mailjet -> Mailjet HTTPS API
```

Both packages implement the existing `ChannelAdapter` contract and register through `adapter-registry-singleton`. `communication_channels` continues to select a tenant-wide channel by `SYSTEM_EMAIL_CHANNEL_ID`, otherwise by `SYSTEM_EMAIL_PROVIDER`, otherwise `resend`.

Provider HTTP calls use `fetchWithTimeout`/`withTimeout` from shared infrastructure. Responses are narrowed with Zod or explicit runtime guards; errors expose a stable provider-prefixed internal code without returning secrets or full provider payloads.

The packages declare `baseEmailCapabilities` with file sharing and conversation history disabled, matching Resend and SES system-email adapters. Inbound normalization and webhook verification remain explicit outbound-only stubs.

### Brevo mapping

| Hub field | Brevo API field |
| --- | --- |
| `metadata.from` / credential fallback | `sender.email` |
| recipients | `to[].email` |
| subject | `subject` |
| `content.html` / `content.text` | `htmlContent` / `textContent` |
| Reply-To | `replyTo.email` |
| attachments | `attachment[]` with `name`, base64 `content`, optional content-type omitted because the API infers it |
| external message id | `messageId` from `POST /v3/smtp/email` |

Health checks call `GET /v3/account` with the same API key and never send email. The response body is discarded because it can contain account PII; the returned details are restricted to the constant endpoint identifier or the allowlisted failure reason and HTTP status.

### Mailjet mapping

| Hub field | Mailjet Send API v3.1 field |
| --- | --- |
| `metadata.from` / credential fallback | `Messages[0].From.Email` |
| recipients | `Messages[0].To[].Email` |
| subject | `Messages[0].Subject` |
| `content.html` / `content.text` | `HTMLPart` / `TextPart` |
| Reply-To | `Messages[0].ReplyTo.Email` |
| attachments | `Messages[0].Attachments[]` with `Filename`, `ContentType`, base64 `Base64Content` |
| external message id | first successful message's `To[0].MessageID`, stringified |

Mailjet uses HTTPS Basic Auth with the public API key as username and secret key as password. The adapter rejects more than 50 recipients and rejects aggregate decoded attachment content above 15 MB before calling Mailjet. Missing attachment MIME types normalize to `application/octet-stream`; messages are not split automatically because the hub contract represents one send operation. Health checks call `GET /v3/REST/myprofile`, discard its PII-bearing response body, return only allowlisted details, and never send email.

## Data Model

No database migration or ORM relationship changes are required. Credentials continue to use `integrationCredentialsService`, encrypted at rest and scoped by tenant and organization.

Credential shapes:

```ts
type BrevoCredentials = {
  apiKey: string
  fromAddress: string
}

type MailjetCredentials = {
  apiKey: string
  secretKey: string
  fromAddress: string
}
```

Secrets are resolved per call, never logged, embedded in error details, or persisted outside the existing credential service.

## API and Configuration Contracts

No Open Mercato HTTP endpoint, event id, database schema, or exported hub type changes.

Provider APIs used:

| Provider | Send | Health |
| --- | --- | --- |
| Brevo | `POST https://api.brevo.com/v3/smtp/email` | `GET https://api.brevo.com/v3/account` |
| Mailjet | `POST https://api.mailjet.com/v3.1/send` | `GET https://api.mailjet.com/v3/REST/myprofile` |

Canonical env presets:

| Variable | Required when selected | Purpose |
| --- | --- | --- |
| `OM_INTEGRATION_BREVO_API_KEY` | Yes | Brevo API key. |
| `OM_INTEGRATION_BREVO_FROM_ADDRESS` | No | Sender override; otherwise use the existing notification/email/admin sender fallback. |
| `OM_INTEGRATION_MAILJET_API_KEY` | Yes | Mailjet public API key. |
| `OM_INTEGRATION_MAILJET_SECRET_KEY` | Yes | Mailjet private API key. |
| `OM_INTEGRATION_MAILJET_FROM_ADDRESS` | No | Sender override; otherwise use the existing sender fallback. |
| `SYSTEM_EMAIL_PROVIDER` | Yes for selection | Accepts the new additive values `brevo` or `mailjet`; default remains `resend`. |

Presets seed credentials and a tenant-wide system-email channel only when their provider is selected and all required values plus a sender address resolve successfully. A partial preset logs a credential-name-only warning and seeds nothing.

Existing tenants can reapply a complete selected preset without exposing credentials in output:

```bash
yarn mercato channel_brevo configure-from-env --tenant <tenantId> --org <organizationId>
yarn mercato channel_mailjet configure-from-env --tenant <tenantId> --org <organizationId>
```

## UI/UX

No provider-specific React surface is added. Auto-discovered integration metadata makes both providers visible in the existing Integrations UI, where operators can:

- view the provider description and documentation link;
- save masked credentials through the existing encrypted credential form;
- enable/disable the integration;
- run the existing health check;
- inspect the tenant-wide system email channel in Communications Hub.

All user-facing metadata follows the existing provider-package pattern. No claim such as “GDPR certified deployment” appears in UI copy.

## Edge Cases and Failure Scenarios

- Missing recipients or subject: return the same internal validation failure shape as Resend/SES before making an HTTP request.
- Invalid credential shape: integration health is `unhealthy`; sends fail through the adapter boundary without logging the secret.
- HTTP timeout/network failure: return `BREVO_SEND_FAILED` or `MAILJET_SEND_FAILED` with a sanitized message; health checks return `request_failed`.
- Provider non-2xx response: parse only documented/safe error text, cap its length, and do not echo request headers or bodies.
- Brevo accepts but omits `messageId`: use a provider-prefixed local fallback id, matching current adapter behavior.
- Mailjet returns HTTP 200 with message-level `Status: error`: treat the send as failed and surface the first documented Mailjet error message.
- Mailjet returns multiple recipient results: use the first successful message id while preserving the existing one-call/multi-recipient semantics.
- Mailjet receives more than 50 recipients: fail before the network call; callers must split the logical notification explicitly.
- Mailjet aggregate decoded attachment content exceeds 15 MB: fail before the network call rather than relying on a provider rejection.
- Unsupported or malformed attachment entries: ignore invalid entries using the existing adapter normalization pattern; Mailjet uses `application/octet-stream` when MIME type is absent, and provider rejection remains a send failure.
- Selected provider package is absent: existing Communications Hub behavior reports that no adapter/config resolver is registered; no fallback silently transfers data to another provider.
- Provider privacy terms change: code continues to function, while docs and issue research must be updated; the adapter itself never encodes a compliance guarantee.

## Integration Coverage

Automated coverage ships with the provider packages:

- contract tests verify module metadata, provider key, integration registration, capabilities, ACLs, and outbound-only behavior;
- adapter tests cover HTML/text, multiple recipients, sender fallback, Reply-To, attachments, successful ids, provider error bodies, network errors, missing subject/recipient, and conversion from outbound message content;
- credential tests cover required/invalid values;
- health tests cover valid account responses, invalid credentials, non-2xx responses, and timeouts with mocked HTTP;
- preset tests cover selected/unselected provider, full/partial env, sender fallback, credential persistence, enabled integration state, and tenant-wide channel creation;
- CLI contract tests prove each selected preset can be reapplied for an existing tenant without logging secrets;
- generated registry checks prove both modules and their CLI commands are discoverable;
- existing `sendEmail()` and Communications Hub suites remain green, proving Resend and SES compatibility.

Executable integration coverage under `packages/channel-brevo/src/modules/channel_brevo/__integration__/` authenticates as an administrator, verifies both providers through the real integrations list/detail APIs, and renders both `/backend/integrations/<provider>` pages. Existing self-contained integration coverage for the shared integrations form verifies secret masking; provider health tests invoke the non-sending endpoint with mocked HTTP and assert the response body is not read; preset, registry, adapter, and Communications Hub `sendSystemEmail` tests cover configuration-to-send routing without live credentials. No provider-specific React component is introduced.

Distribution verification covers every static surface: all three Dockerfile workspace-manifest copy stages, `.github/workflows/package-previews.yml`, app and create-app workspace manifests/module lists, env examples, and generated CLI/module registries.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Marketing copy is mistaken for legal certification | High | Use factual European database-hosting/DPA wording, cite the source and access date, and state operator responsibility and international-processing caveats. | Medium: provider terms can change after release. |
| Secrets leak through Basic Auth or provider errors | High | Build auth headers locally, never log them, sanitize/cap error bodies, and test failures. | Low. |
| Provider API response drift breaks parsing | Medium | Runtime-narrow responses and fail with stable provider-prefixed errors. | Low. |
| Mailjet message-level failure is mistaken for HTTP success | Medium | Inspect each message status and errors even on 2xx responses. | Low. |
| Existing deployments switch provider unexpectedly | High | Keep `resend` default and seed only the explicitly selected provider. | Low. |
| Workspace/template discovery drifts | Medium | Run generators and template sync; test module/package parity. | Low. |

## Migration & Backward Compatibility

This change is additive:

- `sendEmail()` import path and signature do not change.
- `ChannelAdapter`, registry, event, API, ACL, and database contracts do not change.
- `SYSTEM_EMAIL_PROVIDER` gains two accepted provider keys; its default remains `resend`.
- Existing Resend and SES env variables and behavior remain unchanged.
- Removing either new package restores the pre-change provider set; operators must select an installed provider.
- No deprecation bridge or `UPGRADE_NOTES.md` entry is required because no existing surface is renamed, removed, or semantically narrowed.

Rollback removes the two packages and their app/template module entries after operators switch `SYSTEM_EMAIL_PROVIDER` away from them. Stored encrypted credentials and channel rows may remain inert and can be deleted through existing integration/channel administration.

## Alternatives Considered

- Generic SMTP connector: broadly compatible but cannot itself establish provider data location, DPA, or transfer posture; it also loses provider-specific health/error behavior.
- Scaleway TEM first: strong European posture and Paris-only service, but current `v1alpha1` REST stability and 2 MB API message limit make it a better follow-up.
- Add provider switches inside `shared`: rejected because it reintroduces the coupling removed by PR #4471.
- Official SDK dependencies: rejected for these two narrow REST surfaces to avoid production dependency growth and simplify credential/error control.

## Phasing

### Phase 1 — Brevo provider package

Ship a complete, independently installable Brevo system-email connector with env preset, CLI, health check, docs, and tests. Acceptance gate: its package builds and tests without Mailjet installed, its registry entry resolves independently, and removing it leaves existing providers unchanged.

### Phase 2 — Mailjet provider package

Ship a complete, independently installable Mailjet connector with message-level error handling, documented recipient/attachment limits, env preset, CLI, health check, docs, and tests. Acceptance gate: its package builds and tests without Brevo installed, its registry entry resolves independently, and removing it leaves existing providers unchanged.

### Phase 3 — Distribution and verification

Wire both packages into the three Docker build stages, package previews, monorepo app, and create-app template; refresh generated registries; and run executable integration, focused, and repository validation.

## Implementation Plan

1. Add `packages/channel-brevo` by mirroring the Resend provider package structure, with provider-specific credentials, HTTP client, adapter, health check, preset, metadata, ACL, DI/setup, capabilities, build config, and tests.
2. Prove Brevo request/response and failure mapping with mocked HTTP tests, including Reply-To and base64 attachments.
3. Add `packages/channel-mailjet` with the same package boundaries and provider-specific Basic Auth, Send API v3.1 response narrowing, health check, env preset, and tests.
4. Prove Mailjet HTTP-level and message-level failure handling, its 50-recipient and 15 MB aggregate attachment limits, MIME fallback, multiple recipients, Reply-To, and attachment mapping.
5. Add provider-local `configure-from-env` commands, localized ACL metadata, and executable discovery/detail-page integration coverage.
6. Add both workspace dependencies and module entries to all three Dockerfile package-manifest stages, package previews, the monorepo app, and the create-app template using the repository's template-sync workflow; update public email-provider documentation and env examples with the canonical `OM_INTEGRATION_*` variables.
7. Run `yarn install`, `yarn generate`, focused package tests/typechecks, integration spec coverage, template sync checks, dependency/version checks, and the configured validation gate.
8. Review the final diff for secret handling, non-PII health results, provider-only boundaries, generated-file ownership, unchanged Resend/SES behavior, and implementation-accurate spec/changelog notes.

## Sources

Accessed 2026-10-09:

- Brevo data storage and processing: https://help.brevo.com/hc/en-us/articles/360001005510-Where-is-my-data-stored and https://www.brevo.com/legal/termsofuse/
- Brevo API endpoints: https://developers.brevo.com/reference/sendtransacemail and https://developers.brevo.com/reference/getaccount
- Mailjet data storage and processing: https://documentation.mailjet.com/hc/en-us/articles/360042992933-Where-is-my-data-stored and https://sinch.com/legal/data-protection-agreement/
- Mailjet subprocessors: https://sinch.com/legal/sub-processors/
- Mailjet Send API v3.1 and limits: https://documentation.mailjet.com/hc/en-us/articles/360043229473-How-to-send-an-email-with-Mailjet-API and https://dev.mailjet.com/email/guides/send-api-v31/
- Scaleway Transactional Email comparison: https://www.scaleway.com/en/docs/transactional-email/reference-content/tem-limits/ and https://www.scaleway.com/en/developers/api/transactional-email/

## Final Compliance Report

- Provider code stays in dedicated workspace packages and does not add provider logic to `core`, `ui`, or `shared`.
- Existing stable and frozen contracts are reused without modification.
- Tenant/organization credential scoping and encrypted persistence use the existing integration services.
- No database migration, cross-module ORM relationship, or public API change is introduced.
- Failure behavior is testable without live credentials or sending email.
- Provider privacy facts are sourced and qualified; the product does not make a legal-compliance guarantee.

## Changelog

- 2026-10-09: Initial specification for Brevo and Mailjet system transactional-email connectors, researched from current provider documentation and scoped to the existing Communications Hub architecture.
- 2026-10-09: Added the maintainer-requested two-provider scope exception, independent acceptance gates, distribution and executable-test surfaces, Mailjet limits, non-PII health semantics, CLI/i18n requirements, and source citations after architectural review.
