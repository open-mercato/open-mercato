---
title: "Standalone CI runners must mirror webhook-security env from parity scripts"
modules: ["webhooks","create_app","checkout"]
areas: ["integration","architecture","testing"]
topics: ["events","generated-files","database-migrations"]
---

# Standalone CI runners must mirror webhook-security env from parity scripts

**Context**: Standalone snapshot CI started failing payment-gateway and checkout webhook specs with `401` after the forged-webhook hardening made the mock gateway fail closed in production unless `MOCK_GATEWAY_WEBHOOK_SECRET` is configured.

**Problem**: The dedicated standalone GitHub Actions workflow scaffolded and started the app from its own `.env`, but that path omitted `MOCK_GATEWAY_WEBHOOK_SECRET` even though the local parity runner and ephemeral CLI already injected it. Production-mode standalone apps then rejected every signed mock webhook.

**Rule**: Standalone CI and local parity callers must consume `scripts/lib/standalone-integration-env.mjs`, rather than copy environment blocks. Update the shared profile and its negative tests when adding a webhook or another prerequisite. Keep server-only flags separate from Playwright flags, and share absolute paths with queue-drain children. A green monorepo lane does not establish standalone compatibility; verify the scaffold with installed PR packages before merging.

**Follow-up evidence (#8452)**: Email/onboarding prerequisites were added to the monorepo runner without matching standalone configuration. Later tests for disabled modules and worker-dependent behavior accumulated behind the same red lane. Establish the last successful run and inspect the first actual test failure before dating a regression; setup failures can temporarily hide the existing test failures. See [Standalone integration CI](../docs/standalone-integration-ci.md) for shared settings and failure ownership.

**Applies to**: `.github/workflows/snapshot.yml`, standalone parity scripts, and any ad hoc scaffolded-app test harnesses.
