import { EventManager, EventType } from '@mikro-orm/core'
import { TenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { withAgentActor, withRuntimeAuditWrite } from '../lib/identity/agentWriteScope'
import { AgentKindNoBypassSubscriber, AgentWriteBypassError } from '../lib/identity/agentNoBypassSubscriber'

const AGENT_RUN_ENTITY_ID = 'agent_orchestrator:agent_run'

const AGENT_RUN_META = {
  className: 'AgentRun',
  tableName: 'agent_runs',
  hooks: {},
  properties: {
    input: { name: 'input', fieldName: 'input' },
    output: { name: 'output', fieldName: 'output' },
    status: { name: 'status', fieldName: 'status' },
    model: { name: 'model', fieldName: 'model' },
    inputTokens: { name: 'inputTokens', fieldName: 'input_tokens' },
    outputTokens: { name: 'outputTokens', fieldName: 'output_tokens' },
    latencyMs: { name: 'latencyMs', fieldName: 'latency_ms' },
    updatedAt: { name: 'updatedAt', fieldName: 'updated_at' },
  },
}

type ChangeSetStub = {
  type: 'update'
  entity: Record<string, unknown>
  meta: typeof AGENT_RUN_META
  payload: Record<string, unknown>
}

function cipher(value: unknown): string {
  return `enc:${JSON.stringify(value)}`
}

function encryptionService(): TenantDataEncryptionService {
  return {
    isEnabled: () => true,
    async encryptEntityPayload(entityId: string, target: Record<string, unknown>) {
      if (entityId !== AGENT_RUN_ENTITY_ID) return target
      return { ...target, input: cipher(target.input) }
    },
    async decryptEntityPayload() {
      return {}
    },
  } as unknown as TenantDataEncryptionService
}

function loadedRun(): Record<string, unknown> {
  return {
    id: 'run-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    status: 'running',
    input: { prompt: 'check the order' },
    output: null,
  }
}

function updateChangeSet(entity: Record<string, unknown>, payload: Record<string, unknown>): ChangeSetStub {
  Object.assign(entity, payload)
  return { type: 'update', entity, meta: AGENT_RUN_META, payload: { ...payload } }
}

function productionOrderEventManager(): EventManager {
  return new EventManager([new TenantEncryptionSubscriber(encryptionService()), new AgentKindNoBypassSubscriber()])
}

async function flushUpdate(
  eventManager: EventManager,
  changeSet: ChangeSetStub,
  options: { dispatchOnFlush?: boolean } = {},
): Promise<void> {
  const em = { getComparator: () => undefined, getMetadata: () => undefined }
  if (options.dispatchOnFlush !== false) {
    await eventManager.dispatchEvent(EventType.onFlush, { em, uow: { getChangeSets: () => [changeSet] } } as never)
  }
  await eventManager.dispatchEvent(
    EventType.beforeUpdate,
    { entity: changeSet.entity, meta: changeSet.meta, em, changeSet } as never,
    changeSet.meta as never,
  )
}

const TRACE_STAMP = { model: 'gpt-5-mini', inputTokens: 70, outputTokens: 20, latencyMs: 120, updatedAt: new Date() }

/**
 * The tenant encryption subscriber is registered when the DI container is built,
 * the no-bypass guard at the first principal-bound run, so MikroORM runs the
 * encryption `beforeUpdate` first. It re-encrypts `input` into the change-set
 * payload of every `AgentRun` update, which used to make the guard reject the
 * native trace stamp (`ingestTrace`) and the online eval verdict — principal-bound
 * runs then completed with 0 spans and 0 tool calls.
 */
describe('agent no-bypass guard behind the tenant encryption subscriber', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    delete process.env.TENANT_DATA_ENCRYPTION
    registerEntityIds({ agent_orchestrator: { agent_run: AGENT_RUN_ENTITY_ID } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('admits the runtime trace stamp on an AgentRun whose input the encryption subscriber re-encrypts', async () => {
    const eventManager = productionOrderEventManager()
    const changeSet = updateChangeSet(loadedRun(), TRACE_STAMP)

    await withAgentActor({ agentUserId: 'agent-user-1', onBehalfOfUserId: 'human-1' }, () =>
      withRuntimeAuditWrite(() => flushUpdate(eventManager, changeSet)),
    )

    expect(changeSet.payload.input).toBe(cipher({ prompt: 'check the order' }))
    expect(changeSet.payload.model).toBe('gpt-5-mini')
  })

  it('still rejects an AgentRun update whose own changes include input, even though encryption rewrites it', async () => {
    const eventManager = productionOrderEventManager()
    const changeSet = updateChangeSet(loadedRun(), { ...TRACE_STAMP, input: { prompt: 'tampered' } })

    await expect(
      withAgentActor({ agentUserId: 'agent-user-1' }, () =>
        withRuntimeAuditWrite(() => flushUpdate(eventManager, changeSet)),
      ),
    ).rejects.toThrow(AgentWriteBypassError)
  })

  it('still rejects an AgentRun status change inside the runtime-audit scope', async () => {
    const eventManager = productionOrderEventManager()
    const changeSet = updateChangeSet(loadedRun(), { ...TRACE_STAMP, status: 'completed' })

    await expect(
      withAgentActor({ agentUserId: 'agent-user-1' }, () =>
        withRuntimeAuditWrite(() => flushUpdate(eventManager, changeSet)),
      ),
    ).rejects.toThrow(AgentWriteBypassError)
  })

  it('fails closed on the final payload when no onFlush snapshot exists for the change set', async () => {
    const eventManager = productionOrderEventManager()
    const changeSet = updateChangeSet(loadedRun(), TRACE_STAMP)

    await expect(
      withAgentActor({ agentUserId: 'agent-user-1' }, () =>
        withRuntimeAuditWrite(() => flushUpdate(eventManager, changeSet, { dispatchOnFlush: false })),
      ),
    ).rejects.toThrow(AgentWriteBypassError)
  })

  it('does not reuse a snapshot taken for another change set', async () => {
    const eventManager = productionOrderEventManager()
    const traceStamp = updateChangeSet(loadedRun(), TRACE_STAMP)
    const tampered = updateChangeSet(loadedRun(), { status: 'completed' })

    await withAgentActor({ agentUserId: 'agent-user-1' }, () =>
      withRuntimeAuditWrite(async () => {
        await flushUpdate(eventManager, traceStamp)
        await expect(flushUpdate(eventManager, tampered, { dispatchOnFlush: false })).rejects.toThrow(
          AgentWriteBypassError,
        )
      }),
    )
  })

  it('keeps rejecting the trace stamp outside the runtime-audit scope', async () => {
    const eventManager = productionOrderEventManager()
    const changeSet = updateChangeSet(loadedRun(), TRACE_STAMP)

    await expect(
      withAgentActor({ agentUserId: 'agent-user-1' }, () => flushUpdate(eventManager, changeSet)),
    ).rejects.toThrow(AgentWriteBypassError)
  })

  it('leaves human writes untouched', async () => {
    const eventManager = productionOrderEventManager()
    const changeSet = updateChangeSet(loadedRun(), { ...TRACE_STAMP, status: 'completed' })

    await expect(flushUpdate(eventManager, changeSet)).resolves.toBeUndefined()
  })
})
