# Developer Onboarding: Agent Governance Module

## Goal
Help contributors safely extend `agent_governance` without breaking contract surfaces.

## First read
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `.ai/specs/SPEC-050-2026-03-03-agentic-operations-and-governance-module.md`
- `.ai/specs/SPEC-051-2026-03-03-agent-governance-trace-retention-redaction-adr.md`
- `tasks/tasks-agent-governance-v2-full-prd.md`

## Extension rules
- Use command pattern for all writes.
- Add zod validators before adding route handlers.
- Keep event IDs and API URLs backward compatible.
- Keep tenant/org scope checks on every read/write path.
- Treat telemetry envelope as a mandatory contract on governed writes.

## Adding a new governed action
1. Add/update zod schema in `data/validators.ts`.
2. Implement command handler in `commands/`.
3. Emit telemetry via orchestrator/shared command telemetry path.
4. Expose route with `openApi` docs and RBAC metadata.
5. Add tests for scope, durability behavior, and idempotency.

## Adding a new MCP tool
1. Register in `ai-tools.ts` with `requiredFeatures`.
2. Enforce policy/risk-aware grants through tool grant service.
3. Keep tool output serializable and tenant scoped.
4. Add contract tests for permissions and error paths.

## Local verification
- `corepack yarn workspace @open-mercato/core test -- src/modules/agent_governance`
- `corepack yarn workspace @open-mercato/core build`
- `corepack yarn build:packages`

## Migration workflow notes
Preferred: `yarn db:generate` under Node 24.
Fallback on constrained machines: run CLI `db generate` directly with a dedicated local DB and strict module scoping to avoid cross-module noise.
