# Hardened AI Runtime Foundation

> **Status:** Implemented
> **Scope:** OSS, `@open-mercato/ai-assistant`

## TLDR

The optional `OM_AI_RUNTIME_SECURITY_PROFILE=hardened` profile disables legacy Code Mode, enforces input moderation for typed agents, fails closed when the selected provider cannot moderate, and encrypts pending mutation inputs, diffs, and results. The default `standard` profile keeps existing behavior.

## Overview

The MIT AI framework already provides exact tool allowlists and pending-action approval for declared mutation tools. This change adds a deployment-level switch for environments where moderation and approval cannot be optional and where proposal data must not remain plaintext at rest.

## Problem Statement

Before this change, provider capability could silently skip moderation on an `untrustedInput` agent, structured object-mode calls did not run the moderation gate, legacy Code Mode remained reachable, and `ai_pending_actions` stored normalized inputs and diffs without a default encryption map.

## Proposed Solution

- Add the additive `standard | hardened` runtime security profile resolver.
- Disable `POST /api/chat`, the legacy OpenCode Code Mode entrypoint, in hardened mode.
- Treat every typed agent input as untrusted in hardened mode.
- Run the same moderation gate in text and object modes.
- Reject enforced input when the provider lacks moderation support or the moderation service is unavailable.
- Add a default encryption map for pending-action proposal content and execution output.

## Architecture

The profile is resolved lazily from `OM_AI_RUNTIME_SECURITY_PROFILE`. The typed agent runtime applies it before the provider call. The legacy route checks it after authentication. Pending-action writes continue through the existing repository and tenant encryption subscriber.

## Data Models

No schema change is required. The existing `ai_pending_actions` columns `normalized_input`, `field_diff`, `records`, `failed_records`, `side_effects_summary`, and `execution_result` are added to the module encryption map.

## API Contracts

`POST /api/chat` keeps its route and method. In hardened mode an authenticated request receives `503`; in standard mode behavior is unchanged. Typed agent routes keep their response contracts and may return the existing `moderation_unavailable` outcome when required moderation cannot run.

## Integration Coverage

- Unit tests cover profile parsing, unsupported-provider fail-closed behavior, and encryption-map coverage.
- Existing moderation tests continue to cover blocked, unavailable, opt-in, and empty-input behavior.
- Existing pending-action route and repository tests cover the unchanged approval lifecycle.

## Risks & Impact Review

| Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Provider has no moderation endpoint | High | hardened AI availability | Reject before model execution | Operator must choose a supported provider |
| Encryption service is unavailable | High | pending proposal confidentiality | Production encryption policy fails closed | Development may use the standard profile |
| Legacy clients call Code Mode | Medium | legacy chat availability | Explicit 503 and documented migration to typed agents | Client must switch entrypoint |

## Migration & Backward Compatibility

The new environment variable and encryption-map file are additive. The default remains `standard`; existing deployments and public type signatures are unchanged. Enabling hardened mode intentionally changes runtime policy without removing any route or identifier.

## Final Compliance Report

- Tenant and organization scoping remains unchanged.
- Mutation tools still use the existing pending-action approval path.
- Sensitive pending-action fields are covered by the tenant encryption system.
- No generated file or frozen identifier was renamed.

## Changelog

- **2026-08-21:** Implemented the hardened profile, object-mode moderation parity, unsupported-provider fail-closed behavior, legacy Code Mode restriction, and pending-action encryption map.
