/**
 * Registration contract for the three deal-briefing agents.
 *
 * Three of the four things this file asserts are SILENT when they break, which
 * is the whole reason it exists:
 *
 *  1. A tool id the registry cannot resolve is dropped with a warning at
 *     registration, so a typo costs the agent a capability without failing
 *     anything. Here every declared id is checked against the customers packs
 *     that actually declare them.
 *  2. An agent whose `result.schema` is the inner shape rather than the
 *     `{ kind, data }` envelope registers, runs, and then vanishes from
 *     `listAgentOutcomeContracts()` — so `outputMapping: { brief: 'data' }`
 *     stops resolving in the Studio. `resolveAgentOutcomeZod` is what the
 *     platform uses to decide, so it is what is asserted.
 *  3. The voice agent's OUTCOME must be the schema the ElevenLabs connector's
 *     `normalize()` writes against; a drifted copy would fail every real call
 *     AFTER the person had been spoken to.
 *
 * The fourth — that an external agent is researcher-kind — fails loudly at
 * import, and is covered because importing the module at all exercises it.
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import { getAgentEntry } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { resolveAgentOutcomeZod } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/agentOutcomeContract'
import { voiceCallResultSchema } from '@open-mercato/agent-elevenlabs/modules/agent_elevenlabs/data/validators'
import { ELEVENLABS_VOICE_CONNECTOR_ID } from '@open-mercato/agent-elevenlabs/modules/agent_elevenlabs/lib/connector'
import customersAiTools from '@open-mercato/core/modules/customers/ai-tools'
import aiAgents, {
  DEAL_BRIEF_AGENT_ID,
  SALES_CHIEF_CALL_AGENT_ID,
  SALES_CHIEF_CALL_PROFILE,
  TASK_EXTRACTOR_AGENT_ID,
} from '../ai-agents'
import {
  MAX_BRIEFED_DEALS,
  MAX_EXTRACTED_TASKS,
  dealBriefResultSchema,
  taskExtractionResultSchema,
} from '../data/validators'

const customersToolNames = new Set(customersAiTools.map((tool) => tool.name))

describe('sales_call_planner agents', () => {
  it('registers the two native researchers as AiAgentDefinitions', () => {
    expect(aiAgents.map((agent) => agent.id)).toEqual([DEAL_BRIEF_AGENT_ID, TASK_EXTRACTOR_AGENT_ID])
  })

  it('declares every agent researcher-kind, so nothing here can auto-approve a write', () => {
    for (const id of [DEAL_BRIEF_AGENT_ID, SALES_CHIEF_CALL_AGENT_ID, TASK_EXTRACTOR_AGENT_ID]) {
      const entry = getAgentEntry(id)
      expect(entry).toBeDefined()
      expect(entry?.resultKind).toBe('researcher')
      expect(entry?.agentType).toBe('researcher')
    }
  })

  it('registers OUTCOME envelopes the workflows context ledger can project', () => {
    for (const id of [DEAL_BRIEF_AGENT_ID, SALES_CHIEF_CALL_AGENT_ID, TASK_EXTRACTOR_AGENT_ID]) {
      expect(resolveAgentOutcomeZod(getAgentEntry(id)!)).not.toBeNull()
    }
    expect(getAgentEntry(DEAL_BRIEF_AGENT_ID)?.schema).toBe(dealBriefResultSchema)
    expect(getAgentEntry(TASK_EXTRACTOR_AGENT_ID)?.schema).toBe(taskExtractionResultSchema)
  })

  it('resolves every tool the brief agent declares against the customers packs', () => {
    const tools = getAgentEntry(DEAL_BRIEF_AGENT_ID)?.tools ?? []
    expect(tools.length).toBeGreaterThan(0)
    for (const toolName of tools) {
      expect(customersToolNames.has(toolName)).toBe(true)
    }
  })

  it('names no mutation tool, so nothing is stripped at run time', () => {
    const mutationTools = new Set(
      customersAiTools.filter((tool) => tool.isMutation).map((tool) => tool.name),
    )
    for (const id of [DEAL_BRIEF_AGENT_ID, TASK_EXTRACTOR_AGENT_ID]) {
      for (const toolName of getAgentEntry(id)?.tools ?? []) {
        expect(mutationTools.has(toolName)).toBe(false)
      }
    }
  })

  it('does not reach for customers.analyze_deals, which cannot scope to one company', () => {
    expect(getAgentEntry(DEAL_BRIEF_AGENT_ID)?.tools).not.toContain('customers.analyze_deals')
  })

  it('gives the task extractor no tools at all', () => {
    expect(getAgentEntry(TASK_EXTRACTOR_AGENT_ID)?.tools).toEqual([])
  })

  it('wires the voice agent to the ElevenLabs connector under a named profile', () => {
    const entry = getAgentEntry(SALES_CHIEF_CALL_AGENT_ID)
    expect(entry?.runtime).toBe('external')
    expect(entry?.connectorId).toBe(ELEVENLABS_VOICE_CONNECTOR_ID)
    expect(entry?.profile).toBe(SALES_CHIEF_CALL_PROFILE)
    expect(SALES_CHIEF_CALL_PROFILE).not.toBe('default')
    expect(entry?.callbackTimeoutMs).toBe(30 * 60 * 1000)
  })

  it('registers the connector’s own OUTCOME schema, so normalize() cannot drift from it', () => {
    expect(getAgentEntry(SALES_CHIEF_CALL_AGENT_ID)?.schema).toBe(voiceCallResultSchema)
  })

  it('tells the brief agent its deal bound and the extractor its task bound', () => {
    expect(getAgentEntry(DEAL_BRIEF_AGENT_ID)?.instructions).toContain(String(MAX_BRIEFED_DEALS))
    expect(getAgentEntry(TASK_EXTRACTOR_AGENT_ID)?.instructions).toContain(String(MAX_EXTRACTED_TASKS))
  })

  it('documents the reserved callback variable the ElevenLabs prompt must never read', () => {
    expect(getAgentEntry(SALES_CHIEF_CALL_AGENT_ID)?.instructions).toContain('om_callback_url')
    expect(getAgentEntry(SALES_CHIEF_CALL_AGENT_ID)?.instructions).toContain(SALES_CHIEF_CALL_PROFILE)
  })

  it('makes the unanswered-call rule explicit, since that is what stops a voicemail becoming CRM rows', () => {
    expect(getAgentEntry(TASK_EXTRACTOR_AGENT_ID)?.instructions).toContain('call.reached')
  })
})
