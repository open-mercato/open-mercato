import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import { resolveIntegrationDatabaseUrl } from '@open-mercato/core/helpers/integration/dbFixtures'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { generateDek, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { registerTenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { AgentRun, AgentSpan, AgentToolCall } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { defaultEncryptionMaps } from '@open-mercato/enterprise/modules/agent_orchestrator/encryption'
import {
  AgentWriteBypassError,
  registerAgentKindNoBypassSubscriber,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/identity/agentNoBypassSubscriber'
import { withAgentActor, withRuntimeAuditWrite } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/identity/agentWriteScope'
import { buildNativeTracePayload } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/nativeTraceCapture'
import { ingestTrace } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/trace/traceIngestionService'

/**
 * TC-AGENT-ACC-015: the no-bypass guard admits the native trace stamp through a REAL
 * MikroORM flush with tenant data encryption on (#9648 review follow-up, model-free).
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (no-bypass guard, runtime-audit allowlist).
 *
 * TC-AGENT-ACC-013/014 cover the same path end to end but skip without an LLM
 * provider, and `agent-no-bypass-encryption-order.test.ts` stubs the unit of work.
 * This spec drives the production writer (`ingestTrace` over
 * `buildNativeTracePayload`) against a real PostgreSQL unit of work, with the
 * tenant encryption subscriber registered ahead of the no-bypass guard (the
 * production order), under `withAgentActor` + `withRuntimeAuditWrite`. The
 * encryption subscriber re-encrypts `agent_runs.input` into every update's
 * change-set payload; if the guard stopped judging the fields captured at
 * `onFlush`, the stamp would be rejected and the run would record no spans.
 *
 * Library level, like TC-AGENT-EVAL-MOCK-001 and TC-CACC-REVERSE-LINK-002: no
 * app server, no LLM. Self-contained: the tables live in a throwaway schema of
 * the integration database, dropped in `afterAll`.
 */

const AGENT_RUN_ENTITY_ID = 'agent_orchestrator:agent_run'
const AGENT_SPAN_ENTITY_ID = 'agent_orchestrator:agent_span'
const AGENT_TOOL_CALL_ENTITY_ID = 'agent_orchestrator:agent_tool_call'
const AGENT_ID = 'acc015.trace_stamp'
const RUN_INPUT = { prompt: 'Check order SO-1001 for the customer' }

const schema = `agent_acc015_${randomUUID().replaceAll('-', '')}`
const tenantDataEncryption = process.env.TENANT_DATA_ENCRYPTION
let orm: MikroORM

type RunFixture = { runId: string; tenantId: string; organizationId: string }

type RunRow = {
  status: string
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  latency_ms: number | null
  input: unknown
}

function createTestKms(): KmsService {
  const deks = new Map<string, string>()
  const toDek = (tenantId: string, key: string): TenantDek => ({ tenantId, key, fetchedAt: Date.now() })
  return {
    isHealthy: () => true,
    async getTenantDek(tenantId) {
      const key = deks.get(tenantId)
      return key ? toDek(tenantId, key) : null
    },
    async createTenantDek(tenantId) {
      const key = deks.get(tenantId) ?? generateDek()
      deks.set(tenantId, key)
      return toDek(tenantId, key)
    },
  }
}

function agentActor() {
  return { agentUserId: randomUUID(), onBehalfOfUserId: randomUUID() }
}

async function seedSettledRun(): Promise<RunFixture> {
  const em = orm.em.fork()
  const fixture: RunFixture = { runId: randomUUID(), tenantId: randomUUID(), organizationId: randomUUID() }
  const run = em.create(AgentRun, {
    id: fixture.runId,
    tenantId: fixture.tenantId,
    organizationId: fixture.organizationId,
    agentId: AGENT_ID,
    runtime: 'native',
    externalRunId: fixture.runId,
    status: 'ok',
    input: RUN_INPUT,
    completedAt: new Date(),
  })
  em.persist(run)
  await em.flush()
  return fixture
}

async function readRunRow(runId: string): Promise<RunRow> {
  const rows = await orm.em
    .fork()
    .getConnection()
    .execute<RunRow[]>(
      `select status, model, input_tokens, output_tokens, latency_ms, input from "${schema}"."agent_runs" where id = ?`,
      [runId],
    )
  const row = rows[0]
  if (!row) throw new Error(`[internal] agent run ${runId} not found`)
  return row
}

async function countTraceRows(runId: string): Promise<{ spans: number; toolCalls: number }> {
  const em = orm.em.fork()
  return {
    spans: await em.count(AgentSpan, { agentRunId: runId }),
    toolCalls: await em.count(AgentToolCall, { agentRunId: runId }),
  }
}

async function readDecryptedInput(fixture: RunFixture): Promise<unknown> {
  const run = await findOneWithDecryption(
    orm.em.fork(),
    AgentRun,
    { id: fixture.runId, tenantId: fixture.tenantId, organizationId: fixture.organizationId },
    undefined,
    { tenantId: fixture.tenantId, organizationId: fixture.organizationId },
  )
  return run?.input
}

async function deleteRun(fixture: RunFixture | null): Promise<void> {
  if (!fixture) return
  const em = orm.em.fork()
  await em.nativeDelete(AgentToolCall, { agentRunId: fixture.runId })
  await em.nativeDelete(AgentSpan, { agentRunId: fixture.runId })
  await em.nativeDelete(AgentRun, { id: fixture.runId })
}

function traceStampPayload(runId: string) {
  const startedAtMs = Date.now() - 1_000
  return buildNativeTracePayload({
    runId,
    agentId: AGENT_ID,
    startedAtMs,
    endedAtMs: startedAtMs + 640,
    steps: [
      {
        modelId: 'gpt-5-mini',
        finishReason: 'tool-calls',
        usage: { inputTokens: 70, outputTokens: 20 },
        endedAtMs: startedAtMs + 640,
        toolCalls: [
          { toolName: 'search_orders', args: { query: 'SO-1001' }, result: { count: 1 }, durationMs: 15 },
        ],
      },
    ],
  })
}

test.describe('TC-AGENT-ACC-015: agent no-bypass guard over a real encrypted flush', () => {
  test.beforeAll(async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    registerEntityIds({
      agent_orchestrator: {
        agent_run: AGENT_RUN_ENTITY_ID,
        agent_span: AGENT_SPAN_ENTITY_ID,
        agent_tool_call: AGENT_TOOL_CALL_ENTITY_ID,
      },
    })
    orm = await MikroORM.init({
      clientUrl: resolveIntegrationDatabaseUrl(),
      entities: [AgentRun, AgentSpan, AgentToolCall, EncryptionMap],
      metadataProvider: ReflectMetadataProvider,
      schema,
      driverOptions: { options: `-c search_path=${schema}` },
    })
    await orm.schema.create()
    const seeding = orm.em.fork()
    const tracedEntityIds = new Set([AGENT_RUN_ENTITY_ID, AGENT_SPAN_ENTITY_ID, AGENT_TOOL_CALL_ENTITY_ID])
    for (const map of defaultEncryptionMaps.filter((entry) => tracedEntityIds.has(entry.entityId))) {
      seeding.persist(
        seeding.create(EncryptionMap, {
          entityId: map.entityId,
          tenantId: null,
          organizationId: null,
          fieldsJson: map.fields.map((field) => ({ field: field.field, hashField: field.hashField ?? null })),
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      )
    }
    await seeding.flush()
    registerTenantEncryptionSubscriber(orm.em, new TenantDataEncryptionService(orm.em, { kms: createTestKms() }))
    registerAgentKindNoBypassSubscriber(orm.em)
  })

  test.afterAll(async () => {
    try {
      if (orm) await orm.em.getConnection().execute(`drop schema if exists "${schema}" cascade`)
    } finally {
      try {
        if (orm) await orm.close(true)
      } finally {
        if (tenantDataEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
        else process.env.TENANT_DATA_ENCRYPTION = tenantDataEncryption
      }
    }
  })

  test('persists the native trace stamp, spans and tool calls of a principal-bound run', async () => {
    let fixture: RunFixture | null = null
    try {
      fixture = await seedSettledRun()
      const seeded = await readRunRow(fixture.runId)
      expect(isEncryptedPayloadShape(seeded.input)).toBe(true)
      const scope = { tenantId: fixture.tenantId, organizationId: fixture.organizationId }
      const payload = traceStampPayload(fixture.runId)

      const result = await withAgentActor(agentActor(), () =>
        withRuntimeAuditWrite(() => ingestTrace(orm.em.fork(), scope, payload)),
      )

      expect(result).toMatchObject({ runId: fixture.runId, created: false, spansAppended: 2, toolCallsAppended: 1 })
      const stamped = await readRunRow(fixture.runId)
      expect(stamped).toMatchObject({
        status: 'ok',
        model: 'gpt-5-mini',
        input_tokens: 70,
        output_tokens: 20,
        latency_ms: 640,
      })
      expect(isEncryptedPayloadShape(stamped.input)).toBe(true)
      expect(await readDecryptedInput(fixture)).toEqual(RUN_INPUT)
      expect(await countTraceRows(fixture.runId)).toEqual({ spans: 2, toolCalls: 1 })
    } finally {
      await deleteRun(fixture)
    }
  })

  test('rejects a run status change carried by the trace payload and writes nothing', async () => {
    let fixture: RunFixture | null = null
    try {
      fixture = await seedSettledRun()
      const scope = { tenantId: fixture.tenantId, organizationId: fixture.organizationId }
      const payload = { ...traceStampPayload(fixture.runId), status: 'error' }

      await expect(
        withAgentActor(agentActor(), () => withRuntimeAuditWrite(() => ingestTrace(orm.em.fork(), scope, payload))),
      ).rejects.toThrow(AgentWriteBypassError)

      expect(await readRunRow(fixture.runId)).toMatchObject({ status: 'ok', model: null, input_tokens: null })
      expect(await countTraceRows(fixture.runId)).toEqual({ spans: 0, toolCalls: 0 })
    } finally {
      await deleteRun(fixture)
    }
  })

  test('rejects an agent rewrite of the encrypted run input even inside the runtime-audit scope', async () => {
    let fixture: RunFixture | null = null
    try {
      fixture = await seedSettledRun()
      const em = orm.em.fork()
      const run = await findOneWithDecryption(
        em,
        AgentRun,
        { id: fixture.runId, tenantId: fixture.tenantId, organizationId: fixture.organizationId },
        undefined,
        { tenantId: fixture.tenantId, organizationId: fixture.organizationId },
      )
      if (!run) throw new Error('[internal] seeded agent run not found')
      expect(run.input).toEqual(RUN_INPUT)
      run.input = { prompt: 'Refund every open order' }
      run.inputTokens = 5

      await expect(withAgentActor(agentActor(), () => withRuntimeAuditWrite(() => em.flush()))).rejects.toThrow(
        AgentWriteBypassError,
      )

      expect(await readRunRow(fixture.runId)).toMatchObject({ status: 'ok', input_tokens: null })
      expect(await readDecryptedInput(fixture)).toEqual(RUN_INPUT)
    } finally {
      await deleteRun(fixture)
    }
  })
})
