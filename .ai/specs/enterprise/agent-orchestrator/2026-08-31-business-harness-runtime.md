# Business Harness Runtime

## TLDR

File-defined Agent Orchestrator agents move from the standalone OpenCode runtime to a lightweight Open Mercato business harness built on Vercel AI SDK. Open Mercato remains the control plane: it resolves tenant model settings, scopes tools, persists runs and proposals, applies guardrails, and brokers short-lived model and MCP credentials. The harness receives one immutable execution bundle and performs only the model and tool loop.

## Overview

The current `opencode` path starts a general coding-agent runtime, creates an OpenCode session, injects a session token into the prompt, observes SSE, polls `submit_outcome`, and maintains generated OpenCode configuration. That runtime is much larger than the business execution contract requires.

This change adds the `business-harness` runtime and dispatches file-defined agents through it. Historical `opencode` values remain readable. Native code-defined agents continue to use `NativeAgentRunner`.

## Problem Statement

- OpenCode startup and memory cost are high for short business runs.
- OpenCode owns parts of model and agent configuration that belong to OM.
- MCP delivery is coupled to OpenCode configuration.
- Secrets are copied into the OpenCode container instead of being leased for one run.
- Structured completion depends on the `submit_outcome` tool and polling.

## Proposed Solution

Open Mercato compiles an `AgentExecutionBundle` containing:

- the agent definition digest and `business-v1` runtime profile;
- instructions, structured output JSON Schema, loop limits and exact tool ids;
- a model binding resolved from `AiAgentRuntimeOverride`, tenant allowlists and existing environment/provider configuration;
- connector ids without connector URLs or commands;
- a signed, single-run authorization grant without raw credentials.

The harness resolves credentials through an OM broker endpoint, connects to the configured MCP or CLI adapter, runs a Vercel AI SDK `ToolLoopAgent`, validates the output, and returns NDJSON events plus a terminal result.

## Architecture

```text
AgentRuntimeService
  -> BusinessHarnessAgentRunner
     -> create AgentRun and context/guardrail overlays
     -> resolve tenant model binding and exact tools
     -> create caller-scoped MCP session key
     -> sign one-run grant
     -> POST AgentExecutionBundle to business harness
        -> exchange model credential with OM broker
        -> exchange MCP credential with OM broker
        -> run Vercel AI SDK tool loop
        -> return NDJSON events and structured result
     -> validate again with entry.schema
     -> output guardrails
     -> complete AgentRun and create AgentProposal
     -> revoke the session key
```

The transport is selected in harness server configuration. The bundle refers only to the logical `open-mercato` connector. Switching that connector from `mcp-http` to `cli-stdio` does not change agent definitions or OM runner code.

## Runtime and Agent Contracts

`AgentRuntime` gains the additive value `business-harness`. File-agent loader output is registered with this runtime. `opencode` stays in the union, in the agents API response enum and in the UI label and icon maps, and `AgentRuntimeService` dispatches it to `BusinessHarnessAgentRunner` through the shared `BUSINESS_HARNESS_RUNTIME_VALUES` cohort, so historical rows and third-party registry entries keep working for the compatibility window.

The bundle protocol is version `1`. The initial profile is `business-v1`:

- maximum 12 model steps;
- maximum 40 tool calls;
- maximum 120 seconds;
- object-mode output for Agent Orchestrator agents;
- exact, non-wildcard tool allowlists;
- read-only MCP bindings for propose-only agents.

Agent digests are SHA-256 hashes over the canonical instructions, result kind, output schema, tools, skills, sub-agents and loop configuration. Provider credentials and deployment connector details are excluded.

## Model Configuration and Credentials

Model selection reuses the existing OM precedence and tenant scope:

1. agent-specific `AiAgentRuntimeOverride`;
2. tenant-wide `AiAgentRuntimeOverride`;
3. module and global `OM_AI_*` configuration;
4. agent defaults;
5. provider defaults;
6. environment and tenant model allowlists as outer constraints.

The harness supports `openai`, `anthropic`, and registered OpenAI-compatible providers. Unsupported provider protocols fail before the HTTP call.

Provider secrets stay in the OM process environment and are returned only by the credential broker after verifying the run grant and a still-running `AgentRun`. The bundle contains a credential binding id, never the secret.

The capability lease is genuinely single-run: it carries the caller-scoped MCP session key the runner revokes in its `finally`. The model lease is not. It returns the deployment's real provider API key, and `expiresAt` only bounds how long OM will reissue it. A harness process therefore holds a provider credential for its lifetime, in the compose topology as well as in local development. A future encrypted DB credential source, or a per-deployment scoped provider key, can replace the environment source behind the same broker contract without changing the harness.

## Run Grant and Broker API

OM signs an audience-isolated JWT for `business-harness-run`. Claims bind:

- `jti`, `runId`, `agentId`, agent digest;
- tenant, organization and user ids;
- one model audience, binding and provider id;
- one capability audience, binding and MCP session token;
- issue and expiry times.

The grant expires just after the run deadline. Each broker request verifies the signature, body/run match, requested binding, remaining TTL and that the scoped `AgentRun` is still `running`.

```text
POST /api/agent_orchestrator/internal/credentials/exchange
Authorization: Bearer <runGrant>
```

Request:

```json
{
  "protocolVersion": "1",
  "runId": "uuid",
  "purpose": "model",
  "audience": "model:openai",
  "bindingId": "om-env-provider:openai",
  "minimumTtlMs": 125000
}
```

The model response contains the provider key with a lease expiry bounded by the grant (see Model Configuration and Credentials for what that expiry does and does not guarantee). The capability response contains the caller-scoped MCP API key plus `metadata.sessionToken`. Neither endpoint logs or persists returned plaintext.

## Tool and Skill Mapping

The bundle includes `entry.tools` plus:

- `agent_orchestrator.delegate_agent` when sub-agents are declared;
- `agent_orchestrator.load_skill` and `agent_orchestrator.run_skill_script` when skills are declared;
- never `agent_orchestrator.submit_outcome`.

The MCP server continues to re-check the session token and caller ACL on every tool call. The harness removes `_sessionToken` from the model-visible schema and injects it from credential metadata.

## Development Runtime

The harness is a private workspace package with its own HTTP server and Dockerfile. Hybrid dev replaces the `opencode` service with `business-harness` on port 4300. It connects back to host OM on port 3000 for credential exchange and host MCP on port 3001 for tools.

Required configuration:

```text
OM_BUSINESS_HARNESS_URL=http://127.0.0.1:4300
BUSINESS_HARNESS_SERVICE_TOKEN=<shared service token>
BUSINESS_HARNESS_PORT=4300
```

Production rejects a missing service token, and also rejects the fixed fallback token this repository publishes. The harness accepts that placeholder only behind an explicit `HARNESS_ALLOW_INSECURE_TOKEN=true`, which the local dev compose sets and the production compose does not. The production compose declares the token with `:?` so the stack refuses to start unconfigured, and does not publish the harness port to the host.

## Data Models

No new database entity is required for the development integration. Existing `AgentRun`, `AgentRunSession`, session API keys, `AiAgentRuntimeOverride` and `AiTenantModelAllowlist` remain authoritative.

No domain writes move into the harness. The existing proposal, disposition and effector flow remains unchanged.

## API Contracts

The broker route is additive and machine-to-machine. It has no staff-session authentication because the audience-bound run grant is the credential. It is rate limited before cryptographic and database work.

The harness API is internal:

```text
GET  /healthz
POST /v1/runs
```

`POST /v1/runs` requires the deployment service token. JSON and NDJSON responses are supported.

## Integration Coverage

- Runtime dispatch selects `BusinessHarnessAgentRunner` for a file agent.
- Bundle compiler produces a deterministic digest, full AgentResult JSON Schema, exact read-only tools and no `submit_outcome`.
- Model descriptor honors tenant overrides and rejects unsupported drivers.
- Run grants reject a different run, binding, audience, tenant or expired token.
- Broker returns a provider lease and a caller-scoped MCP lease, then refuses a terminal run.
- Client consumes NDJSON events and the terminal result and handles an NDJSON error.
- Runner completes a researcher result and a proposal result through existing persistence helpers.
- Harness package tests cover MCP, CLI stdio, policy, credentials, HTTP, tool loops and the placeholder service-token guard.
- OM-side tests cover the run grant, the credential broker route, the bundle compiler against the harness's own `AgentExecutionBundleSchema`, the NDJSON reader, runtime dispatch including the `opencode` alias, the subprocess pool and the runtime health route.
- Dev smoke test verifies harness `/healthz`, broker authentication and one real file-agent run when a provider key is configured.

## Migration and Backward Compatibility

- `business-harness` is an additive runtime value; `opencode` is retained and deprecated, never removed.
- Existing `opencode` database rows, API filters, response enums and UI labels remain supported, and an `opencode` registry entry dispatches to the harness runner.
- OpenCode-specific source and Docker files remain for one compatibility window but are no longer the default dev or file-agent runtime.
- `submit_outcome` and its MCP id remain registered during the window, although the harness does not expose it.
- The public `agentRuntime.run()` signature and AgentResult contract do not change.

## Risks and Impact Review

### Credential broker leaks a provider key

Severity: Critical. The endpoint verifies an audience-isolated grant, exact binding, scoped running row and TTL. It returns `Cache-Control: no-store`, logs no body, and never includes a secret in errors. Residual risk: low.

### Harness receives a wider tool set than the agent declared

Severity: High. Bundle construction uses exact ids, strips `submit_outcome`, MCP annotations must mark read-only tools, and MCP applies caller ACL again. Wildcards are rejected in the harness. Residual risk: low.

### Tenant model policy diverges from native runtime

Severity: Medium. The descriptor uses `createModelFactory` with the same tenant override and allowlist repositories. Tests pin precedence and provider mapping. Residual risk: low.

### Harness or broker is unavailable

Severity: Medium. The runner has an abortable wall-clock deadline, fails the existing AgentRun, revokes the session key in `finally`, and does not retry the whole business run. Residual risk: low.

### One-off subprocesses exhaust the host

Severity: Medium. `delegate_agent` fan-out runs nested, and nested runs bypass the `acquireAgentRunSlot` admission gate by design so a parent cannot livelock behind its own children. In stdio mode each nested run is a Node process loading the AI SDK, so the fan-out was unbounded once the OpenCode container lease was removed. `BusinessHarnessProcessClient` now holds a process-wide FIFO semaphore, default 4, tunable with `OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES`; waiters are abortable and release their slot. Residual risk: low.

### Grant expires during harness startup

Severity: Low. The harness asks the broker for a lease covering `timeoutMs + 5s`, so `GRANT_MARGIN_MS` minus that 5s is the entire budget for subprocess spawn, SDK load and config read. At the original 30s margin a slow start produced an opaque `CREDENTIAL_EXCHANGE_FAILED`. The margin is now 90s. Residual risk: low.

### OpenAI-compatible endpoint is used for SSRF

Severity: High. The harness accepts compatible endpoints only when their origin appears in server-owned `modelPolicy.allowedOpenAICompatibleOrigins`. The bundle cannot add to that allowlist. Residual risk: low.

## Final Compliance Report

- Propose-only persistence and disposition stay in OM.
- Every MCP call remains caller and tenant scoped.
- Runtime and API additions are additive.
- No existing agent, tool, event, feature or DI id is renamed.
- The existing model and tenant override surfaces remain authoritative.
- No migration is applied locally.

## Changelog

### 2026-08-31

- Initial implementation specification for replacing the default file-agent OpenCode path with the business harness.
- Review follow-up: `opencode` retained as a deprecated runtime label that dispatches to the harness; production compose requires a generated service token and stops publishing the harness port; the harness rejects the published placeholder token; one-off subprocesses bounded by a FIFO semaphore; grant margin widened to 90s; the model lease documented as the real provider key rather than a scoped one; OM-side coverage added for the grant, broker, bundle, NDJSON reader, dispatch, pool and health route.
