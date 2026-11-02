# Issue #3805: Direct tool mutation approval boundary

## TLDR

Reject `isMutation: true` tools at `POST /api/ai_assistant/tools/execute` before invoking a handler. Preserve read tools and the existing agent policy, preview, and confirmation paths.

## Overview

This security fix implements the existing mutation approval contract in the [unified AI tooling spec](implemented/2026-04-11-unified-ai-tooling-and-subagents.md). It changes one HTTP boundary; no new entity, service, dependency, or approval protocol is introduced.

## Problem Statement

The direct endpoint authenticates the caller, loads ACL and module tools, then calls `executeTool`. That helper validates features and inputs and invokes the raw handler. Possession of a write feature therefore permits a mutation without an agent policy decision, preview, or confirmation. Superadmin status also does not supply human approval.

## Proposed Solution

After module tool loading, resolve the requested tool from the registry. When its server-owned `isMutation` flag is `true`, return HTTP 403 with the existing `{ success: false, error: string }` envelope and a localized explanation directing clients to the agent dispatcher. Client-supplied agent, policy, approval, and pending-action fields grant no exemption. Otherwise use the existing executor unchanged.

## Architecture

The guard belongs to the direct HTTP endpoint because it has no trusted agent or approval context. `executeTool` is also used by `agent-tools.ts`, `in-process-client.ts`, `mcp-server.ts`, `mcp-dev-server.ts`, and `http-server.ts`. In particular, the agent wrapper can execute a non-destructive mutation under `destructive-confirm-required`; changing the executor globally would break that legitimate path. Confirm-required tools instead call `prepareMutation`, while `pending-action-executor.ts` invokes approved handlers after confirmation checks. These internal callers and MCP transport semantics remain unchanged.

## Data Models

No database, pending-action state, version, or migration changes.

## API Contracts

- Mutation calls to `POST /api/ai_assistant/tools/execute`: previously successful calls now return 403 without invoking their handler.
- Read tools, including legacy tools without `isMutation`, retain execution, tool ACL checks, input validation, scoped context, and response shape.
- Unknown tools, authentication failures, endpoint feature metadata, chat/run-object dispatch, and action confirmation retain their behavior.

## Migration & Backward Compatibility

This intentionally narrows STABLE API behavior (category 7). Continued acceptance of direct mutation calls is the vulnerability itself, so a bridge or opt-in bypass would preserve the exploit. Request the Emergency Security Exception for deprecation steps 1–3 only. A named human maintainer must explicitly acknowledge the waiver before merge; no automated verdict supplies that approval.

Clients must move mutation requests to a registered, allowlisted agent through chat or run-object and follow its effective mutation policy, including confirmation of pending actions when required. Read-only requests can continue using the endpoint. Operators should deploy the fix, identify clients relying on direct mutations, and audit prior direct mutation requests and affected records for missing approvals. No credentials or stored records are invalidated, and the change does not roll back or retrospectively approve earlier writes. See [upgrade notes](../../UPGRADE_NOTES.md#direct-ai-tool-mutations-require-agent-policy-3805) and the dated [compatibility entry](../../BACKWARD_COMPATIBILITY.md#3805-2026-10-31).

## Integration Coverage

Self-contained Jest boundary tests invoke the real route, tool registry, executor, schema validation, and ACL feature matcher with in-memory tools; authentication/container setup and tool discovery are controlled fixtures. They prove mutation handlers are never called for ordinary users, superadmins, forged approval fields, and late-loaded tools. They also exercise read execution, scoped context, ACL denial, invalid inputs, unknown tools, and authentication. Four mutation cases first fail against the old route by observing actual handler calls.

Agent-wrapper tests exercise real policy checks and the shared executor: chat and object tools stage confirmation through `prepareMutation`, tenant read-only downgrades and missing tool features exclude writes, and policy-permitted non-destructive mutations still execute. Existing pending-action executor and confirm-route tests verify the approved execution boundary. No UI files change; no browser interaction is introduced.

## Risks & Impact Review

| Failure scenario | Severity / area | Mitigation and residual risk |
|---|---|---|
| Existing direct mutation client stops writing | High / API compatibility | Explicit 403 and migration disclosure; named maintainer waiver required before merge. |
| Shared executor guard accidentally blocks approved or policy-permitted writes | High / AI runtime | Keep the guard at the direct route and exercise agent/confirm paths. |
| Tool falsely declares itself read-only | Existing high / tool authorship | Continue requiring truthful mutation metadata; this change does not infer handler side effects. |
| Client claims approval in request JSON | High / approval bypass | No client-controlled exemption; boundary regressions cover forged fields. |

## Final Compliance Report

No schema, tenant scoping, ACL feature, public type, internal execution signature, dependency, or governance policy changes. The compatibility document receives only the required dated entry. Automated tests must demonstrate red/green behavior; full validation results and environment limitations are recorded in the issue analysis. Human security-waiver approval and a green configured gate remain merge requirements.

## Changelog

- 2026-10-31: Documented #3805 endpoint guard, caller analysis, regression coverage, compatibility exception, and client/operator migration.
