# Pluggable Outbound Email Providers

## TLDR

Open Mercato's outbound email utility currently assumes Resend. This change keeps Resend as the default provider and adds provider selection for outbound transactional email, with Amazon SES as the first additional provider.

## Problem Statement

Transactional email is used by onboarding, password reset, notifications, messages, checkout, and sales flows. Deployments that already run on AWS should be able to use SES without forking these modules or changing call sites. Existing Resend installations must continue to work without any configuration changes.

Inbox Ops inbound email processing is intentionally out of scope. It depends on Resend receiving webhooks and remains Resend-specific.

## Proposed Solution

- Add `EMAIL_PROVIDER=resend | ses` for outbound email.
- Keep the current default: when `EMAIL_PROVIDER` is unset, use Resend and require `RESEND_API_KEY`.
- Add SES support through the AWS SDK credential chain and `AWS_SES_REGION` / `AWS_REGION` region resolution.
- Preserve the existing `sendEmail(options)` contract.
- Preserve sender precedence: `NOTIFICATIONS_EMAIL_FROM`, `EMAIL_FROM`, then `ADMIN_EMAIL`.
- Add `isEmailDeliveryConfigured()` so UI and setup checks do not assume Resend.

## Architecture

The shared email package remains the only outbound abstraction used by core modules. Provider-specific code is isolated inside `@open-mercato/shared/lib/email`:

- Resend provider passes the existing React email payload to Resend.
- SES provider renders React email to HTML/text and sends through SES raw email transport so attachments and reply-to continue to work.
- Call sites continue to call `sendEmail()` and do not branch on provider.

No database schema, API route, event, ACL, CLI, or generated contract changes are introduced.

## API Contracts

`sendEmail(options)` remains unchanged:

```ts
type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: string
    contentType?: string
  }>
}
```

New environment variables:

| Variable | Purpose |
| --- | --- |
| `EMAIL_PROVIDER` | Optional outbound provider. Defaults to `resend`; supports `resend` and `ses`. |
| `AWS_SES_REGION` | Optional SES region override. |
| `AWS_REGION` | Fallback region used by AWS SDK and SES provider. |

Existing variables remain supported:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Required for Resend outbound email. |
| `NOTIFICATIONS_EMAIL_FROM` | First sender fallback. |
| `EMAIL_FROM` | Default sender fallback. |
| `ADMIN_EMAIL` | Final sender fallback and operational admin recipient. |

## Migration & Backward Compatibility

- Backward compatible: existing deployments with `RESEND_API_KEY` and no `EMAIL_PROVIDER` continue using Resend.
- The public `sendEmail()` function signature is unchanged.
- Existing import paths are unchanged.
- SES is opt-in and additive.
- Inbox Ops inbound Resend webhooks are not changed and continue to require Resend configuration.

## Test Plan

- Resend default behavior still passes with `EMAIL_PROVIDER` unset.
- Explicit `EMAIL_PROVIDER=resend` uses Resend.
- `EMAIL_PROVIDER=ses` uses SES transport, maps sender/reply-to, renders HTML/text, and forwards attachments.
- SES region resolution prefers `AWS_SES_REGION`, then `AWS_REGION`, then AWS SDK defaults.
- Disabled delivery still skips provider initialization.
- `isEmailDeliveryConfigured()` reports valid Resend and SES configurations accurately.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual Risk |
| --- | --- | --- | --- |
| Existing Resend deployments regress | High | Keep Resend default and preserve tests | Low |
| SES attachment formatting differs from Resend | Medium | Use raw SES transport and add attachment tests | Low |
| UI setup checks still require Resend | Medium | Use provider-neutral configuration helper | Low |
| Inbox Ops expectations become ambiguous | Medium | Document inbound Resend as out of scope | Low |

## Final Compliance Report

- Public function signatures are preserved.
- Import paths are preserved.
- No database, API, event, ACL, or generated contracts are changed.
- Provider behavior is additive and opt-in.
- Fork-specific deployment details are excluded.

## Changelog

- 2026-06-03: Created spec for pluggable outbound email providers with Resend default and optional Amazon SES support.
