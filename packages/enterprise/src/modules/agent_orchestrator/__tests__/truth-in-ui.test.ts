/** @jest-environment node */
// Data-honesty spec §3.7 — the truth-in-UI trio: the playground surfaces
// guardrail blocks as policy verdicts (pure mapper + page wiring), the agents
// detail autonomy control is disabled (a live-looking safety mock is banned),
// and process-list mappers keep nulls instead of coercing to 0/epoch.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { runErrorStateFromBody } from '../components/playgroundRunError'
import { mapProcessListRow } from '../components/processTypes'

const MODULE_DIR = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(MODULE_DIR, rel), 'utf8')
const LOCALES = ['en', 'es', 'de', 'pl'] as const

describe('runErrorStateFromBody (playground guardrail-block mapping)', () => {
  it('maps a guardrail_blocked body to the typed guardrail state', () => {
    expect(
      runErrorStateFromBody({
        error: 'Blocked by a runtime guardrail',
        code: 'guardrail_blocked',
        kind: 'pii',
        phase: 'output',
        guardrailSetVersion: 'sha256:x',
      }),
    ).toEqual({ kind: 'guardrail', guardrailKind: 'pii', phase: 'output' })
  })

  it('falls back to "unknown" for a guardrail body with missing reason fields', () => {
    expect(runErrorStateFromBody({ code: 'guardrail_blocked' })).toEqual({
      kind: 'guardrail',
      guardrailKind: 'unknown',
      phase: 'unknown',
    })
  })

  it('maps a plain error body to the generic state with its message', () => {
    expect(runErrorStateFromBody({ error: 'Agent produced invalid output' })).toEqual({
      kind: 'generic',
      message: 'Agent produced invalid output',
    })
  })

  it('maps null / non-object / empty bodies to the generic state with no message', () => {
    expect(runErrorStateFromBody(null)).toEqual({ kind: 'generic', message: null })
    expect(runErrorStateFromBody('oops')).toEqual({ kind: 'generic', message: null })
    expect(runErrorStateFromBody({ error: '   ' })).toEqual({ kind: 'generic', message: null })
  })
})

describe('playground page wiring (source invariants)', () => {
  const page = read('backend/playground/page.tsx')

  it('renders the distinct guardrail alert (ShieldAlert + interpolated copy), separate from the generic error', () => {
    expect(page).toContain('runErrorStateFromBody')
    expect(page).toContain('ShieldAlert')
    expect(page).toContain('agent_orchestrator.playground.guardrailBlocked')
  })

  it('uses the honest declared-tools empty state, never the false "No tools were used"', () => {
    expect(page).toContain('agent_orchestrator.playground.result.noDeclaredTools')
    expect(page).not.toContain('playground.result.noTools\'')
  })

  it('ships the guardrailBlocked copy with kind/phase interpolation in all four locales', () => {
    for (const locale of LOCALES) {
      const catalog = JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>
      const copy = catalog['agent_orchestrator.playground.guardrailBlocked']
      expect(copy).toContain('{kind}')
      expect(copy).toContain('{phase}')
      expect(catalog['agent_orchestrator.playground.result.noDeclaredTools']).toBeTruthy()
      expect(catalog['agent_orchestrator.playground.result.noTools']).toBeUndefined()
    }
  })
})

describe('agents detail autonomy control (source invariants)', () => {
  // The agent detail page was split into a tabbed workspace
  // (2026-07-24 agent-centric-workspace-and-eval-consolidation); the autonomy
  // control moved to the shared workspace primitives but MUST stay disabled.
  const primitives = read('backend/agents/[id]/components/workspacePrimitives.tsx')

  it('renders the segmented control disabled with no change handler plumbing', () => {
    const segmented = primitives.slice(primitives.indexOf('function AutonomySegmented'))
    expect(segmented).toContain('disabled')
    expect(primitives).not.toContain('onAutonomyChange')
    expect(primitives).not.toContain('onValueChange={(next) => onChange')
  })
})

describe('mapProcessListRow null-honesty', () => {
  const BASE = {
    process_id: '33333333-3333-4333-8333-333333333333',
    status: 'in_progress',
    agent_ids: [],
  }

  it('keeps unknown cost/currency/openedAt/subjectValue as nulls (no 0 / epoch coercion)', () => {
    const row = mapProcessListRow(BASE as unknown as Record<string, unknown>)
    expect(row).not.toBeNull()
    expect(row!.costMinor).toBeNull()
    expect(row!.currency).toBeNull()
    expect(row!.openedAt).toBeNull()
    expect(row!.subjectValueMinor).toBeNull()
  })

  it('passes real values through untouched', () => {
    const row = mapProcessListRow({
      ...BASE,
      cost_minor: 157,
      currency: 'USD',
      opened_at: '2026-07-10T10:00:00.000Z',
      subject_value_minor: 4_200_000,
    } as unknown as Record<string, unknown>)
    expect(row!.costMinor).toBe(157)
    expect(row!.currency).toBe('USD')
    expect(row!.openedAt).toBe('2026-07-10T10:00:00.000Z')
    expect(row!.subjectValueMinor).toBe(4_200_000)
  })
})
