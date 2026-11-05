---
title: "Standalone template env examples must mirror security-sensitive app env keys"
modules: ["create_app","catalog","webhooks"]
areas: ["architecture","integration","testing"]
topics: ["generated-files","package-runtime","template-sync"]
---

# Standalone template env examples must mirror security-sensitive app env keys

**Context**: Payment gateway webhook hardening introduced `MOCK_GATEWAY_WEBHOOK_SECRET` as the explicit non-production signing secret for the mock gateway. The monorepo app `.env.example` documented it, but the standalone template `.env.example` did not.

**Problem**: Standalone parity and local generated apps can silently miss required security-sensitive env keys even when the monorepo app documents them, leading to standalone-only regressions that look like product bugs.

**Rule**: When a feature adds a new app-level env var required for local, test, or non-production behavior, update both `apps/mercato/.env.example` and `packages/create-app/template/.env.example` in the same change. If standalone CI/bootstrap scripts synthesize `.env`, set the same var there explicitly too.

**Applies to**: `apps/mercato/.env.example`, `packages/create-app/template/.env.example`, create-app smoke/parity scripts, and any new env-backed local/testing security feature.
