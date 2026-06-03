# System Outbound Email Providers Through Communications Hub

## TLDR

Transactional outbound email should use the existing Communications Hub instead of hardcoding provider delivery inside `@open-mercato/shared`. This change keeps the public `sendEmail(options)` import path, registers a hub-backed transport at runtime, configures Resend as the default system email provider from env, and adds Amazon SES as the first additional provider package.

Inbox Ops inbound/reply behavior remains out of scope and stays Resend-specific.

## Problem Statement

Password resets, invitations, onboarding, notifications, messages, checkout, and sales flows all need transactional email. The previous utility assumed Resend directly. AWS-hosted deployments need SES without forking all of those modules, but provider-specific code should not live in `shared` or core call sites.

Maintainer feedback on PR #2448 requested this to be modeled as external integrations through the communications hub, with Resend configured by env as the default, rather than a hardcoded Resend/AWS provider switch.

## Proposed Solution

- Keep `sendEmail(options)` as the compatibility entrypoint.
- Make `@open-mercato/shared/lib/email` provider-neutral: sender fallback, disabled delivery, transport registration, and no provider SDK dependencies.
- Register a `communication_channels` system email transport from core DI.
- Resolve system email delivery through:
  - `SYSTEM_EMAIL_CHANNEL_ID` when set,
  - otherwise `SYSTEM_EMAIL_PROVIDER`,
  - otherwise default provider `resend`.
- Add external provider packages:
  - `@open-mercato/channel-resend` with provider key `resend`.
  - `@open-mercato/channel-ses` with provider key `ses`.
- Provider packages own adapter registration, system-email env credential resolution, and env preconfiguration.
- Pre-tenant system email, such as self-service onboarding verification, uses the same hub adapter registry with env credentials when no tenant channel exists yet.

## Architecture

`shared` exports a small transport registry and the existing `sendEmail(options)` function. It never imports `core`, Resend, Nodemailer, or AWS SDK code.

`communication_channels` registers an email transport that resolves a tenant-wide email channel (`userId: null`) and calls the provider adapter synchronously. This preserves the old `await sendEmail(...)` behavior for security-sensitive flows like password reset and invites.

Provider packages implement outbound-only `ChannelAdapter`s and register their own system-email config resolvers:

- Resend adapter sends via the Resend Node SDK.
- SES adapter sends through Nodemailer SES transport backed by AWS SDK v3 credential chain.

Env preconfiguration is provider-owned:

- `channel_resend` seeds tenant-wide credentials/channel when `RESEND_API_KEY` and a sender address are present.
- `channel_ses` seeds tenant-wide credentials/channel when `AWS_SES_REGION` or `AWS_REGION` and a sender address are present.

## API Contracts

`sendEmail(options)` keeps the existing import path and signature shape. Additive optional fields allow scoped hub delivery:

```ts
type SendEmailOptions = {
  to: string
  subject: string
  react?: React.ReactElement
  html?: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: string
    contentType?: string
  }>
  tenantId?: string
  organizationId?: string | null
}
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `SYSTEM_EMAIL_PROVIDER` | Optional default system email provider. Defaults to `resend`; supports registered provider keys such as `resend` and `ses`. |
| `SYSTEM_EMAIL_CHANNEL_ID` | Optional explicit tenant-wide communication channel id. |
| `RESEND_API_KEY` | Resend API key used by `channel_resend` env preconfiguration and pre-tenant fallback. |
| `AWS_SES_REGION` | SES region used by `channel_ses`; falls back to `AWS_REGION`. |
| `AWS_REGION` | AWS SDK region fallback. |
| `AWS_SES_CONFIGURATION_SET` | Optional SES configuration set. |
| `NOTIFICATIONS_EMAIL_FROM` | First sender fallback. |
| `EMAIL_FROM` | Default sender fallback. |
| `ADMIN_EMAIL` | Final sender fallback and operational admin recipient. |

## Migration & Backward Compatibility

- Existing `sendEmail()` imports continue to work.
- Existing Resend deployments continue to work when `RESEND_API_KEY` and a sender address are set, because `SYSTEM_EMAIL_PROVIDER` defaults to `resend`.
- `shared` no longer contains provider delivery code or provider dependencies.
- SES is additive through `@open-mercato/channel-ses`.
- Inbox Ops inbound/reply Resend webhook behavior is unchanged.

## Test Plan

- Shared tests cover transport delegation, disabled delivery, sender fallback, missing transport, configuration checks, attachments, `replyTo`, and scope propagation.
- Resend adapter tests mock the Resend SDK and verify HTML/text rendering, `replyTo`, attachments, and provider failure handling.
- SES adapter tests mock Nodemailer/AWS SDK and verify region resolution, HTML/text rendering, `replyTo`, attachments, configuration set mapping, and provider failure handling.
- Communication hub tests cover system email dispatch through the adapter registry and pre-tenant env fallback.
- Run focused package tests/typechecks, `yarn check:dep-versions`, generated registry refresh, and the full contrib gate before moving the draft PR toward review.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual Risk |
| --- | --- | --- | --- |
| Existing Resend deployments regress | High | Keep Resend as default provider and add adapter tests | Low |
| Pre-tenant onboarding loses email delivery | High | Add env-backed hub adapter fallback for no-tenant sends | Low |
| Provider code leaks into `shared` | Medium | Keep provider SDK dependencies only in provider packages | Low |
| SES attachment formatting differs from Resend | Medium | Use Nodemailer SES transport and add attachment tests | Low |
| Inbox Ops expectations become ambiguous | Medium | Document inbound Resend as out of scope | Low |

## Final Compliance Report

- Public import paths are preserved.
- `sendEmail()` is backward-compatible with additive optional fields.
- No database schema, API route, event, ACL, CLI, or generated contract is removed.
- Provider behavior is additive and isolated to provider packages.
- Fork-specific deployment details are excluded.

## Changelog

- 2026-06-03: Updated spec to use Communications Hub system email transport with Resend default and SES as an external provider package.
