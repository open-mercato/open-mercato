---
name: om-integration-builder
description: Build integration provider packages for the Open Mercato Integration Marketplace. Use when creating new external integrations (payment gateways, shipping carriers, data sync connectors, communication channels, storage providers, webhook endpoints). Handles npm package scaffolding, adapter implementation, credentials, widget injection, webhook processing, health checks, i18n, and tests. Triggers on "build integration", "create integration", "add provider", "new connector", "integrate with", "add stripe/paypal/dhl/sendgrid" etc.
---

# Integration Builder

Build an integration provider for the Open Mercato Integration Marketplace (SPEC-045) —
a payment gateway, shipping carrier, data-sync connector, communication channel, storage
provider, or webhook endpoint. In a standalone app the provider is a regular module under
`src/modules/<provider>/`; the contract (adapter, credentials, webhooks, health check) is
identical to the monorepo.

## When to use

- The user asks to connect an external service (Stripe, PayPal, DHL, InPost, SendGrid, S3, Medusa, …).
- Triggers: "build integration", "add provider", "new connector", "integrate with X".
- Not for editing the framework's integration hubs themselves — those are read-only under `node_modules/@open-mercato/*/dist/`.

## What it contains

A six-step procedure that scaffolds the provider module, wires the marketplace
`integration.ts` registration, implements the hub adapter with status mapping and a
credential-resolving client, adds webhook processing / health check / config widget, adds
i18n and tests, and runs the script-probed validation gate. Every provider ends as a
self-contained module registered in the app-root `src/modules.ts`.

## Reference map — load only the step in play

| When | Load |
|------|------|
| **Always, first** — where the provider lives, `src/modules.ts` registration, script-probed build/validation, read-only framework, reference impl location | `references/standalone-layout.md` |
| Full adapter type definitions per hub category (Gateway / Shipping / DataSync / Channel / Webhook / Storage) | `references/adapter-contracts.md` |
| Pre-flight, pick the hub category, scaffold the module tree, register it | `workflow/step-1-preflight-and-scaffold.md` |
| Marketplace `integration.ts` / bundle, `index.ts`, `acl.ts`, `setup.ts`, `di.ts` | `workflow/step-2-core-files.md` |
| Adapter implementation, status mapping, credential-resolving client factory, encryption | `workflow/step-3-adapter-and-credentials.md` |
| Webhook handler + worker + setup guide, health check, config widget injection | `workflow/step-4-webhooks-health-widgets.md` |
| i18n locale files, unit tests, integration tests | `workflow/step-5-i18n-and-tests.md` |
| Script-probed validation gate, self-review checklist, hard rules | `workflow/step-6-validation.md` |

## Non-negotiables

- Implement the FULL adapter contract for the chosen hub — no partial adapters; map ALL provider statuses with an `'unknown'` fallback.
- Never store or log credentials — resolve them fresh from the `credentials` param on every call; encrypt at rest via the `IntegrationCredentials` service.
- Use the provider SDK (or timing-safe comparison) for webhook signature verification; add a webhook setup guide on the secret field.
- No hardcoded user-facing strings (`useT()` / `resolveTranslations()`); no `any` types; run the script-probed gate before declaring done.
