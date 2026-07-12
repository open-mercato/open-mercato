import fs from 'node:fs'
import path from 'node:path'
import { summarizeProposalActions, summarizeProposalShaped } from '../components/proposalFactsData'
import {
  actionEditsToActions,
  deriveActionEdits,
  parseRawActions,
  reassembleProposalPayload,
  stringifyActions,
} from '../components/proposalEdit'

/**
 * Spec 4 Phase 4 (content correctness): proposal summaries come from the
 * canonical `{actions}` payload — never rationale prose — and edits target
 * `actions[n].payload` fields (raw hatch scoped to the actions array), with
 * confidence/rationale preserved verbatim as agent testimony.
 */

const canonicalPayload = {
  actions: [
    { type: 'set_stage', payload: { stage: 'negotiation', dealId: 'D-1', amount: 4200, urgent: true } },
    { type: 'notify_owner', payload: { channel: 'email' } },
  ],
  confidence: 0.85,
  rationale: 'Engagement recency and stage age put this deal in the nurture band.',
}

describe('summarizeProposalActions', () => {
  it('renders the humanized first action type plus the extra-action count', () => {
    const parts = summarizeProposalActions(canonicalPayload)
    expect(parts).toEqual({ typeRaw: 'set_stage', typeLabel: 'Set stage', extraCount: 1 })
  })

  it('never returns rationale prose for non-canonical payloads', () => {
    expect(summarizeProposalActions({ rationale: 'Long prose sentence.' })).toBeNull()
    expect(summarizeProposalActions({ decision: 'approve' })).toBeNull()
    expect(summarizeProposalActions(null)).toBeNull()
    expect(summarizeProposalActions('text')).toBeNull()
    expect(summarizeProposalActions({ actions: [] })).toBeNull()
    expect(summarizeProposalActions({ actions: [{ payload: {} }] })).toBeNull()
  })

  it('humanizes snake_case and camelCase types, non-Latin-safe', () => {
    expect(summarizeProposalActions({ actions: [{ type: 'ustaw_etap', payload: {} }] })?.typeLabel).toBe('Ustaw etap')
    expect(summarizeProposalActions({ actions: [{ type: 'setStage', payload: {} }] })?.typeLabel).toBe('Set Stage')
  })

  it('keeps the exported shaped summary for the facts path', () => {
    expect(summarizeProposalShaped(canonicalPayload)).toBe('set_stage · 85%')
  })
})

describe('deriveActionEdits', () => {
  it('derives typed editable fields per action and preserves non-primitive entries', () => {
    const payload = {
      actions: [
        { type: 'set_stage', payload: { stage: 'won', amount: 10, nested: { keep: true }, tags: ['a'] } },
      ],
      rationale: 'r',
    }
    const edits = deriveActionEdits(payload)
    expect(edits).toHaveLength(1)
    expect(edits![0].type).toBe('set_stage')
    expect(edits![0].fields).toEqual([
      { key: 'stage', kind: 'string', value: 'won' },
      { key: 'amount', kind: 'number', value: 10 },
    ])
    expect(edits![0].preserved).toEqual({ nested: { keep: true }, tags: ['a'] })
  })

  it('returns null for non-canonical payloads (legacy editing path)', () => {
    expect(deriveActionEdits({ decision: 'approve' })).toBeNull()
    expect(deriveActionEdits({ actions: [] })).toBeNull()
    expect(deriveActionEdits(null)).toBeNull()
  })
})

describe('reassembly', () => {
  it('replaces only actions — rationale, confidence, and extra keys pass through verbatim', () => {
    const original = { ...canonicalPayload, extraKey: { audit: 1 } }
    const edits = deriveActionEdits(original)!
    edits[0].fields = edits[0].fields.map((field) => (field.key === 'stage' ? { ...field, value: 'won' } : field))
    const reassembled = reassembleProposalPayload(original, actionEditsToActions(edits))
    expect(reassembled.rationale).toBe(canonicalPayload.rationale)
    expect(reassembled.confidence).toBe(0.85)
    expect(reassembled.extraKey).toEqual({ audit: 1 })
    const actions = reassembled.actions as Array<{ type: string; payload: Record<string, unknown> }>
    expect(actions[0].payload.stage).toBe('won')
    expect(actions[0].payload.amount).toBe(4200)
    expect(actions[0].payload.urgent).toBe(true)
    expect(actions[1]).toEqual(canonicalPayload.actions[1])
  })

  it('coerces number and boolean field edits back to their types', () => {
    const edits = deriveActionEdits(canonicalPayload)!
    edits[0].fields = edits[0].fields.map((field) => {
      if (field.key === 'amount') return { ...field, value: '9000' }
      if (field.key === 'urgent') return { ...field, value: false }
      return field
    })
    const [first] = actionEditsToActions(edits)
    expect(first.payload.amount).toBe(9000)
    expect(first.payload.urgent).toBe(false)
  })
})

describe('parseRawActions (escape hatch, actions array only)', () => {
  it('accepts a valid actions array and rejects JSON/shape errors', () => {
    const valid = parseRawActions(stringifyActions(canonicalPayload.actions))
    expect(valid).toEqual({ ok: true, actions: canonicalPayload.actions })
    expect(parseRawActions('{not json')).toEqual({ ok: false, error: 'json' })
    expect(parseRawActions('{"actions": []}')).toEqual({ ok: false, error: 'shape' })
    expect(parseRawActions('[{"payload": {}}]')).toEqual({ ok: false, error: 'shape' })
  })

  it('raw-hatch parity: raw round-trip reassembles the same payload as field edits', () => {
    const edits = deriveActionEdits(canonicalPayload)!
    const viaFields = reassembleProposalPayload(canonicalPayload, actionEditsToActions(edits))
    const raw = parseRawActions(stringifyActions(actionEditsToActions(edits)))
    expect(raw.ok).toBe(true)
    if (raw.ok) {
      expect(reassembleProposalPayload(canonicalPayload, raw.actions)).toEqual(viaFields)
    }
  })
})

describe('source invariants', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')

  it('the caseload page no longer probes DECISION_KEYS or first-string prose', () => {
    const page = read('backend/caseload/page.tsx')
    expect(page).not.toContain('DECISION_KEYS')
    expect(page).not.toContain('firstString')
    expect(page).toContain('summarizeProposalActions')
  })

  it('the structured editor never renders confidence or rationale inputs', () => {
    const card = read('components/ProposalCard.tsx')
    expect(card).toContain('deriveActionEdits')
    expect(card).toContain('reassembleProposalPayload')
    expect(card).not.toMatch(/setRationale|setConfidence/)
  })

  it('the playground consumer stays read-only (no actions prop, edit footer gated on actions)', () => {
    const playground = read('backend/playground/page.tsx')
    expect(playground).toContain('adHoc={{')
    expect(playground).not.toMatch(/<ProposalCard[\s\S]{0,400}actions=\{/)
    const card = read('components/ProposalCard.tsx')
    expect(card).toContain("mode === 'view' && actions && isPending")
  })

  it('the new editor and summary keys exist in all four locales', () => {
    const keys = [
      'agent_orchestrator.caseload.proposes.more',
      'agent_orchestrator.proposal.edit.actionLabel',
      'agent_orchestrator.proposal.edit.actionsHeading',
      'agent_orchestrator.proposal.edit.fieldsToggle',
      'agent_orchestrator.proposal.edit.invalidActions',
      'agent_orchestrator.proposal.edit.noEditableFields',
      'agent_orchestrator.proposal.edit.rawActionsLabel',
      'agent_orchestrator.proposal.edit.rawToggle',
    ]
    for (const locale of ['en', 'es', 'de', 'pl']) {
      const catalog = JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>
      for (const key of keys) {
        expect(catalog[key]).toBeTruthy()
      }
      expect(catalog['agent_orchestrator.caseload.proposes.more']).toContain('{count}')
      expect(catalog['agent_orchestrator.proposal.edit.actionLabel']).toContain('{type}')
    }
  })
})
