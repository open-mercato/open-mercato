---
title: "Standalone CI runners must mirror webhook-security env from parity scripts"
modules: ["webhooks","create_app","checkout"]
areas: ["integration","architecture","testing"]
topics: ["events","generated-files","database-migrations"]
---

# Standalone CI runners must mirror webhook-security env from parity scripts

**Context**: Standalone snapshot CI started failing payment-gateway and checkout webhook specs with `401` after the forged-webhook hardening made the mock gateway fail closed in production unless `MOCK_GATEWAY_WEBHOOK_SECRET` is configured.

**Problem**: The dedicated standalone GitHub Actions workflow scaffolded and started the app from its own `.env`, but that path omitted `MOCK_GATEWAY_WEBHOOK_SECRET` even though the local parity runner and ephemeral CLI already injected it. Production-mode standalone apps then rejected every signed mock webhook.

**Rule**: Whenever standalone test runners or CI workflows boot a scaffolded app outside the shared parity scripts, copy the full webhook-related env contract too, including `MOCK_GATEWAY_WEBHOOK_SECRET`. Keep workflow env blocks aligned with `scripts/test-create-app-integration.ts` and the CLI ephemeral test environment.

**Applies to**: `.github/workflows/snapshot.yml`, standalone parity scripts, and any ad hoc scaffolded-app test harnesses.
