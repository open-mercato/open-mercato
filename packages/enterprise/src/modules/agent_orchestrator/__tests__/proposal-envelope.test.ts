import fs from 'node:fs'
import path from 'node:path'
import { describe, test, expect } from '@jest/globals'
import { agentProposalSchema, proposalOptionSchema } from '../data/validators'
import {
  deriveEnvelopeConfidence,
  leadProposalOption,
  listProposalOptionIds,
  normalizeProposalEnvelope,
  rankProposalOptions,
  readProposalActions,
  replaceOptionActions,
} from '../data/proposalEnvelope'

/**
 * The proposal envelope (spec `2026-08-11-agent-taxonomy.md`, Phase 1).
 *
 * `normalizeProposalEnvelope` is the RUNTIME TWIN of the backfill migration: both
 * lift a pre-envelope `{ actions, confidence, rationale }` payload onto one implicit
 * option, and both must turn an EMPTY action list into an empty option SET rather
 * than an option that would fail `actions.min(1)`. The two are asserted against the
 * same rule here so they cannot drift.
 */

const ACTION = { type: 'set_stage', payload: { stage: 'won' } }

describe('the option schema states the bounds', () => {
  test('an option must carry at least one action', () => {
    expect(proposalOptionSchema.safeParse({ id: 'a', label: 'A', actions: [] }).success).toBe(false)
    expect(proposalOptionSchema.safeParse({ id: 'a', label: 'A', actions: [ACTION] }).success).toBe(true)
  })

  test('an envelope may legally carry no options at all', () => {
    expect(agentProposalSchema.safeParse({ options: [] }).success).toBe(true)
  })

  test('the pre-envelope shape does NOT validate — this is a wire change, not a generalization', () => {
    expect(agentProposalSchema.safeParse({ actions: [ACTION], confidence: 0.9 }).success).toBe(false)
  })

  test('bounds: at most ten options, a 120-char label, a 2000-char rationale', () => {
    const option = { id: 'a', label: 'A', actions: [ACTION] }
    expect(agentProposalSchema.safeParse({ options: Array(11).fill(option) }).success).toBe(false)
    expect(proposalOptionSchema.safeParse({ ...option, label: 'x'.repeat(121) }).success).toBe(false)
    expect(proposalOptionSchema.safeParse({ ...option, rationale: 'x'.repeat(2001) }).success).toBe(false)
  })
})

describe('normalizeProposalEnvelope — the backfill rule, at runtime', () => {
  test('a pre-envelope payload becomes ONE implicit option labelled with the agent id', () => {
    const envelope = normalizeProposalEnvelope(
      { actions: [ACTION], confidence: 0.85, rationale: 'because' },
      'deals.health_check',
    )
    expect(envelope).toEqual({
      options: [
        { id: 'primary', label: 'deals.health_check', actions: [ACTION], confidence: 0.85 },
      ],
      rationale: 'because',
    })
    expect(agentProposalSchema.safeParse(envelope).success).toBe(true)
  })

  test('an EMPTY action list backfills to an empty option SET, never to an invalid option', () => {
    const envelope = normalizeProposalEnvelope({ actions: [], confidence: 0.4, rationale: 'nothing to do' })
    expect(envelope).toEqual({ options: [], rationale: 'nothing to do' })
    expect(agentProposalSchema.safeParse(envelope).success).toBe(true)
  })

  test('an already-canonical envelope passes through untouched', () => {
    const envelope = { options: [{ id: 'a', label: 'A', actions: [ACTION], confidence: 0.3 }], rationale: 'r' }
    expect(normalizeProposalEnvelope(envelope)).toEqual(envelope)
  })

  test('an option carrying no runnable action is dropped rather than persisted invalid', () => {
    const envelope = normalizeProposalEnvelope({
      options: [
        { id: 'a', label: 'A', actions: [] },
        { id: 'b', label: 'B', actions: [ACTION] },
      ],
    })
    expect(listProposalOptionIds(envelope)).toEqual(['b'])
  })

  test('duplicate option ids are disambiguated — selectedOptionId must never be ambiguous', () => {
    const envelope = normalizeProposalEnvelope({
      options: [
        { id: 'a', label: 'A', actions: [ACTION] },
        { id: 'a', label: 'A2', actions: [ACTION] },
      ],
    })
    expect(listProposalOptionIds(envelope)).toEqual(['a', 'a_2'])
  })

  test('bounds are clamped, not rejected — a long rationale must not lose the whole proposal', () => {
    const envelope = normalizeProposalEnvelope({ actions: [ACTION], rationale: 'x'.repeat(5000), confidence: 4 })
    expect(agentProposalSchema.safeParse(envelope).success).toBe(true)
    expect(envelope.rationale).toHaveLength(2000)
    expect(envelope.options[0].confidence).toBe(1)
  })

  test('anything that is not a proposal at all yields an empty option set', () => {
    expect(normalizeProposalEnvelope(null)).toEqual({ options: [] })
    expect(normalizeProposalEnvelope('text')).toEqual({ options: [] })
    expect(normalizeProposalEnvelope({ decision: 'approve' })).toEqual({ options: [] })
  })
})

describe('derived envelope confidence', () => {
  const envelope = {
    options: [
      { id: 'low', label: 'Low', actions: [ACTION], confidence: 0.2 },
      { id: 'high', label: 'High', actions: [ACTION], confidence: 0.9 },
    ],
  }

  test('ranks highest confidence first; a declared-none option ranks as zero', () => {
    const ranked = rankProposalOptions([
      { id: 'none', label: 'None', actions: [ACTION] },
      { id: 'some', label: 'Some', actions: [ACTION], confidence: 0.1 },
    ])
    expect(ranked.map((option) => option.id)).toEqual(['some', 'none'])
  })

  test('before a verdict it is the LEADER option', () => {
    expect(deriveEnvelopeConfidence(envelope)).toBe(0.9)
    expect(leadProposalOption(envelope)?.id).toBe('high')
  })

  test('after a verdict it is the CHOSEN option', () => {
    expect(deriveEnvelopeConfidence(envelope, 'low')).toBe(0.2)
  })

  test('null when no option declares one — the column must not invent certainty', () => {
    expect(deriveEnvelopeConfidence({ options: [{ id: 'a', label: 'A', actions: [ACTION] }] })).toBeNull()
    expect(deriveEnvelopeConfidence({ options: [] })).toBeNull()
  })

  test('falls back to a top-level confidence so a pre-envelope OUTCOME does not null the facet', () => {
    expect(deriveEnvelopeConfidence({ confidence: 0.83 })).toBe(0.83)
  })

  test('an unknown option id resolves to no confidence rather than the leader', () => {
    expect(deriveEnvelopeConfidence(envelope, 'nope')).toBeNull()
  })
})

describe('reading and editing one option', () => {
  const envelope = {
    options: [
      { id: 'a', label: 'A', actions: [ACTION], confidence: 0.9 },
      { id: 'b', label: 'B', actions: [{ type: 'notify', payload: {} }], confidence: 0.5 },
    ],
    rationale: 'set',
  }

  test('the plan that runs is the chosen option’s, or the leader’s absent a choice', () => {
    expect(readProposalActions(envelope)).toEqual([ACTION])
    expect(readProposalActions(envelope, 'b')).toEqual([{ type: 'notify', payload: {} }])
  })

  test('an edit replaces ONE option’s plan and preserves the rest of the testimony', () => {
    const edited = replaceOptionActions(envelope, [{ type: 'set_stage', payload: { stage: 'lost' } }], 'a')
    expect(edited.options[0].actions).toEqual([{ type: 'set_stage', payload: { stage: 'lost' } }])
    expect(edited.options[0].confidence).toBe(0.9)
    expect(edited.options[1]).toEqual(envelope.options[1])
    expect(edited.rationale).toBe('set')
  })
})

describe('the backfill migration applies the same rule as the runtime twin', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'Migration20260811090000_agent_orchestrator.ts'),
    'utf8',
  )

  test('adds both columns', () => {
    expect(sql).toContain('"selected_option_id" varchar(100) null')
    expect(sql).toContain('"auto_disposition_block" varchar(20) null')
  })

  test('has a SEPARATE branch writing an empty option set for an empty action list', () => {
    expect(sql).toContain("'options', '[]'::jsonb")
    expect(sql).toContain(`jsonb_array_length("payload" -> 'actions') = 0`)
    expect(sql).toContain(`jsonb_array_length("payload" -> 'actions') > 0`)
  })

  test('rewrites persisted INVOKE_AGENT outputMapping dot-paths in both definition tables', () => {
    expect(sql).toContain(`'"proposalPayload.actions'`)
    expect(sql).toContain(`'"proposalPayload.options[0].actions'`)
    expect(sql).toContain('workflow_definitions')
    expect(sql).toContain('workflow_definition_drafts')
  })
})
