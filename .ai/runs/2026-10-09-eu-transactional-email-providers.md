# Execution Plan: EU Transactional Email Providers

Source doc: `.ai/specs/2026-10-09-eu-transactional-email-providers.md` (spec PR #7129)
Issue: #5556

## Goal

Ship tested Brevo and Mailjet system-email provider packages on the existing Communications Hub without changing stable email, hub, database, or HTTP contracts.

## Scope

- Add independent `@open-mercato/channel-brevo` and `@open-mercato/channel-mailjet` packages.
- Implement outbound email mapping, credential validation, bounded health checks, env presets, integration metadata, ACLs, and tests.
- Wire both packages into the monorepo app and create-app template.
- Document selection and canonical provider env variables.
- Refresh generated registries and validate compatibility with Resend/SES.

## Non-goals

- No generic SMTP adapter.
- No inbound email, webhooks, delivery receipts, marketing-email, or contact-list support.
- No provider-specific UI component, database migration, or shared/core adapter-contract change.
- No claim that installing a provider makes an operator GDPR-compliant.

## Risks

- Provider error bodies may contain unsafe or excessive detail; adapters will cap and sanitize surfaced text.
- Mailjet can return message-level failures in a successful HTTP response; the adapter must inspect message status.
- App/template discovery can drift; module/package/env wiring will be mirrored and template-sync verified.
- Provider terms can change independently of code; docs use factual, qualified wording and link official sources.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Brevo connector

- [ ] 1.1 Add the Brevo provider package and contract tests
- [ ] 1.2 Implement Brevo send, health, and env-preset tests

### Phase 2: Mailjet connector

- [ ] 2.1 Add the Mailjet provider package and contract tests
- [ ] 2.2 Implement Mailjet send, health, and env-preset tests

### Phase 3: Distribution and documentation

- [ ] 3.1 Wire both packages into app and template discovery
- [ ] 3.2 Document provider selection, privacy boundary, and env presets

### Phase 4: Verification and review

- [ ] 4.1 Refresh generated artifacts and run focused validation
- [ ] 4.2 Run the configured validation gate and address review findings
