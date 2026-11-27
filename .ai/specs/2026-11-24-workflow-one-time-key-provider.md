# API Keys provider for workflow requests

Extends: .ai/specs/2026-07-26-workflows-ux-redesign.md

## TLDR

Workflows delegates one-time credential issuance for `CALL_API` to API Keys over server DI. Workflows keeps the existing activity, execution identity, and HTTP behavior.

## Resolved assumptions (autonomous defaults)

Use a separate provider design for credential issuance. The named-rule cutover has independent call paths and validation. Keep transport in Workflows because it enforces the activity's request and response contract.

## Overview

This is the API Keys part of workstream 2 of [#10476](https://github.com/open-mercato/open-mercato/issues/10476). Implement after [#10129](https://github.com/open-mercato/open-mercato/pull/10129). The [named-rule provider](2026-11-24-workflow-named-rule-provider.md) can ship independently.

## Problem Statement

The baseline detects when API Keys is missing and returns a translated failure. The active path still imports the peer's helper and manages credential persistence details in Workflows. [Existing activity](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/core/src/modules/workflows/lib/activity-executor.ts#L1789-L1855)

## Proposed Solution

Use an API Keys-owned service through the existing Awilix registration flow. Operation ownership follows the provider pattern in the [Terraform provider framework](https://developer.hashicorp.com/terraform/plugin/framework/providers).

## Architecture

- Add an API Keys-owned server registration `apiKeyOneTimeIssuer` wrapping the shipped `withOnetimeApiKey`. Put its narrow interface in the owner public service surface or, if needed for package independence, the shared server contracts. Accept the existing explicit tenant, organization and authorized role IDs, plus the current display metadata and a scoped callback. The interface has no workflow imports.
- Workflows soft-resolves the capability from the active execution container. A missing registration takes the existing translated API Keys-unavailable path. A present dependency that fails takes normal activity failure and retry classification. Keep the private key internal to the callback and out of logs, output contracts and queues.
- Workflows continues to resolve the initiating user's current permissions or the existing authorized author fallback, enforce trusted trigger identity, and own the HTTP request, target and redirect checks, cancellation, response classification and output. Use its existing context-free EntityManager for role resolution. The API Keys provider must also persist and clean up through an isolated manager outside the workflow transaction, retaining the request visibility, expiry and cleanup behavior of the shipped helper. Preserve callback completion and cleanup on success, error and abort.

## Data Model

Keep existing key and workflow records. Continue to use the existing expiry and cleanup path. No new stored data or migration is required.

## API Contracts

The existing `CALL_API` registry entry stays synchronous with the same schema, activity ID and result envelope. Editor and workflow APIs continue to recognize saved activities. No new routes or UI surfaces are introduced.

## Migration & Backward Compatibility

Keep the public `withOnetimeApiKey` export and current activity contract. The provider registration is additive. Older deployments can read the same workflow definitions and keys. Prior HTTP effects use existing workflow recovery semantics.

## Risks & Impact Review

| Risk | Mitigation and residual risk |
|---|---|
| High — a key gains broader authority or reaches an ineligible request. | Preserve identity, scope and request checks. Exercise the existing deny paths and key cleanup. The implementation requires authentication-boundary review. |
| High — the internal request cannot see the key or cleanup is lost after failure. | Keep isolated persistence. Exercise a real activity inside the workflow transaction and verify visibility and cleanup on completion, failure and abort. |

## Phasing

Characterize and cut over the owner boundary in one implementation PR.

## Implementation Plan

1. Pin identity, result shape, transaction visibility and cleanup with the existing `TC-WF-9217` CALL_API integration and executor tests.
2. Add API Keys registration and switch the activity. Verify permitted internal requests, denied scope/identity, normal failure handling and the translated missing-issuer result. Exercise supported reduced apps or an unregistered test capability where the preset retains API Keys.
3. Check the existing activity registry and authored definitions against both old and new behavior. Verify that overrides and workflow execution use one request-scoped resolution path.

## Final Compliance Report

Reviewed scope, identity, credential handling, additive DI and existing workflow contracts. Runtime verification belongs to the implementation PR.

## Changelog

- 2026-11-24 — Proposed API Keys-owned credential issuance for #10476.
