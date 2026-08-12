/**
 * The external-agent seam (design `2026-08-12-external-agent-invocation-analysis.md`,
 * §3 governance + §5.3 connector registry + §5.4 authoring; tracker task 2.2).
 *
 * Three claims are load-bearing here:
 *
 * 1. A connector id resolves to exactly ONE connector. It is what the
 *    unauthenticated callback route picks a signature verifier from, so a second
 *    registration under the same id must fail loudly rather than take over.
 * 2. `defineExternalAgent` writes an ordinary `AgentRegistryEntry`, so the agents
 *    cockpit, `listAgentOutcomeContracts()` and the workflows context ledger keep
 *    working with no change — that is the whole reason it reuses the registry.
 * 3. External agents are researcher-kind ONLY. An external *proposal* agent would
 *    let a third party's self-reported confidence auto-approve a domain write, so
 *    registration fails closed.
 */

// Keep the cross-module aggregator and the file-agent manifest out of the registry
// so only the agents this file declares are in play.
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))

import { z, type ZodTypeAny } from 'zod'
import type { AwilixContainer } from 'awilix'
import { getAgentEntry } from '../lib/sdk/defineAgent'
import { defineExternalAgent } from '../lib/sdk/defineExternalAgent'
import {
  clearExternalAgentConnectorsForTests,
  getExternalAgentConnector,
  listExternalAgentConnectors,
  registerExternalAgentConnector,
  type ExternalAgentConnector,
} from '../lib/runtime/externalConnectorRegistry'
import { AgentWorkflowBridgeService } from '../lib/runtime/invokeAgentForWorkflow'

const CONNECTOR_ID = 'test.voice'

const ownerCallOutcome = z.object({
  reached: z.boolean(),
  transcript: z.string(),
})

const ownerCallEnvelope = z.object({ kind: z.literal('researcher'), data: ownerCallOutcome })

function stubConnector(overrides: Partial<ExternalAgentConnector> = {}): ExternalAgentConnector {
  return {
    id: CONNECTOR_ID,
    start: async () => ({ externalRunId: 'conv-1', expectsCallback: true }),
    verifyCallback: () => true,
    normalize: (raw) => raw,
    ...overrides,
  }
}

describe('external agent connector registry', () => {
  beforeEach(() => {
    clearExternalAgentConnectorsForTests()
  })

  it('resolves a registered connector by id', () => {
    const connector = stubConnector()
    registerExternalAgentConnector(connector)
    expect(getExternalAgentConnector(CONNECTOR_ID)).toBe(connector)
    expect(listExternalAgentConnectors()).toEqual([connector])
  })

  it('returns undefined for an unknown connector id', () => {
    expect(getExternalAgentConnector('nobody.here')).toBeUndefined()
  })

  it('rejects a second connector claiming the same id', () => {
    registerExternalAgentConnector(stubConnector())
    expect(() => registerExternalAgentConnector(stubConnector())).toThrow(
      /duplicate external agent connector id "test\.voice"/,
    )
    // The first registration survives — a failed takeover must not leave the
    // registry holding the impostor.
    expect(listExternalAgentConnectors()).toHaveLength(1)
  })

  it('carries an optional cancel and mock without requiring them', () => {
    const cancel = jest.fn(async () => {})
    registerExternalAgentConnector(stubConnector({ cancel }))
    const resolved = getExternalAgentConnector(CONNECTOR_ID)
    expect(resolved?.cancel).toBe(cancel)
    // `mock` absent means REFUSE (never dial, never fabricate) — the runner reads
    // its absence rather than the registry inventing a payload here.
    expect(resolved?.mock).toBeUndefined()
  })
})

describe('defineExternalAgent', () => {
  it('registers an ordinary registry entry with runtime "external" and the connector id', () => {
    const entry = defineExternalAgent({
      id: 'voice.owner_call',
      moduleId: 'voice_agents',
      label: 'Call the business owner',
      description: 'Places an outbound voice call and collects a decision.',
      connectorId: CONNECTOR_ID,
      agentType: 'researcher',
      result: { kind: 'researcher', schema: ownerCallEnvelope },
      timeout: '30m',
      sampleInput: { phone: '+48000000000' },
    })

    expect(entry.runtime).toBe('external')
    expect(entry.connectorId).toBe(CONNECTOR_ID)
    expect(entry.resultKind).toBe('researcher')
    // 30m resolved through the SAME duration grammar workflow authors already type.
    expect(entry.callbackTimeoutMs).toBe(30 * 60 * 1000)
    // No in-process surface: an external agent calls no tools and delegates to nobody.
    expect(entry.tools).toEqual([])
    expect(entry.skills).toEqual([])
    expect(entry.subAgents).toEqual([])
    expect(entry.instructions).toBe('')

    // It is discoverable through the SAME registry every other agent uses.
    expect(getAgentEntry('voice.owner_call')).toBe(entry)
  })

  it('accepts ISO 8601 durations as well as the simple form', () => {
    const entry = defineExternalAgent({
      id: 'voice.iso_timeout',
      moduleId: 'voice_agents',
      label: 'ISO timeout',
      description: '',
      connectorId: CONNECTOR_ID,
      result: { kind: 'researcher', schema: ownerCallEnvelope },
      timeout: 'PT45M',
    })
    expect(entry.callbackTimeoutMs).toBe(45 * 60 * 1000)
  })

  it('REJECTS a proposal result kind — an external proposal would let a third party auto-approve a write', () => {
    expect(() =>
      defineExternalAgent({
        id: 'voice.rogue_proposer',
        moduleId: 'voice_agents',
        label: 'Rogue proposer',
        description: '',
        connectorId: CONNECTOR_ID,
        result: { kind: 'proposal', schema: z.object({ kind: z.literal('proposal'), proposal: z.unknown() }) },
        timeout: '30m',
      }),
    ).toThrow(/external agents must be researcher/)
    // Fail CLOSED: the rejected agent is not in the registry at all.
    expect(getAgentEntry('voice.rogue_proposer')).toBeUndefined()
  })

  it('rejects an unparseable, non-positive or missing deadline', () => {
    const base = {
      moduleId: 'voice_agents',
      label: 'Bad deadline',
      description: '',
      connectorId: CONNECTOR_ID,
      result: { kind: 'researcher' as const, schema: ownerCallEnvelope },
    }
    expect(() => defineExternalAgent({ ...base, id: 'voice.bad_timeout', timeout: 'soon' })).toThrow(
      /unparseable timeout "soon"/,
    )
    expect(() => defineExternalAgent({ ...base, id: 'voice.zero_timeout', timeout: '0m' })).toThrow(
      /non-positive timeout "0m"/,
    )
    expect(getAgentEntry('voice.bad_timeout')).toBeUndefined()
    expect(getAgentEntry('voice.zero_timeout')).toBeUndefined()
  })

  it('rejects a blank connector id', () => {
    expect(() =>
      defineExternalAgent({
        id: 'voice.no_connector',
        moduleId: 'voice_agents',
        label: 'No connector',
        description: '',
        connectorId: '  ',
        result: { kind: 'researcher', schema: ownerCallEnvelope },
        timeout: '30m',
      }),
    ).toThrow(/must name a connectorId/)
  })

  it('refuses a duplicate agent id, like every other registration path', () => {
    defineExternalAgent({
      id: 'voice.duplicate',
      moduleId: 'voice_agents',
      label: 'First',
      description: '',
      connectorId: CONNECTOR_ID,
      result: { kind: 'researcher', schema: ownerCallEnvelope },
      timeout: '30m',
    })
    expect(() =>
      defineExternalAgent({
        id: 'voice.duplicate',
        moduleId: 'voice_agents',
        label: 'Second',
        description: '',
        connectorId: CONNECTOR_ID,
        result: { kind: 'researcher', schema: ownerCallEnvelope },
        timeout: '30m',
      }),
    ).toThrow(/duplicate agent id "voice\.duplicate"/)
  })
})

describe('an external agent flows through the unchanged downstream projections', () => {
  it('appears in listAgentOutcomeContracts() with its researcher schema', async () => {
    const bridge = new AgentWorkflowBridgeService({
      container: { resolve: () => undefined } as unknown as AwilixContainer,
      agentRuntime: {} as never,
      dispositionService: {} as never,
    })
    const contracts = await bridge.listAgentOutcomeContracts()
    const contract = contracts.find((item) => item.agentId === 'voice.owner_call')
    expect(contract).toBeDefined()
    expect(contract?.resultKind).toBe('researcher')
    // The projected schema is the INNER outcome, which is what makes
    // `outputMapping: { call: 'data.transcript' }` typed in the Studio.
    expect(contract?.schema.safeParse({ reached: true, transcript: 'hello' }).success).toBe(true)
    expect(contract?.schema.safeParse({ reached: 'yes' }).success).toBe(false)
  })

  it('serializes through the agents-list route against its own published response schema', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    // No tenant/org on the auth: the route then skips the presentation-override
    // lookup, so this exercises the registry projection and nothing else.
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1' })

    const { GET, openApi } = await import('../api/agents/route')
    const response = await GET(new Request('http://localhost/api/agent_orchestrator/agents'))
    expect(response.status).toBe(200)
    const body = await response.json()

    const responseSchema = openApi.methods.GET?.responses?.[0]?.schema as ZodTypeAny
    // The cockpit route must not 500 on an external entry: parse the REAL body
    // against the REAL published schema rather than a copy of it.
    const parsed = responseSchema.safeParse(body)
    expect(parsed.success).toBe(true)

    const items = (body as { items: Array<Record<string, unknown>> }).items
    const item = items.find((entry) => entry.id === 'voice.owner_call')
    expect(item?.runtime).toBe('external')
    expect(item?.resultKind).toBe('researcher')
    expect(item?.agentType).toBe('researcher')
    expect(item?.outcomeSchema).toBeDefined()
  })
})
