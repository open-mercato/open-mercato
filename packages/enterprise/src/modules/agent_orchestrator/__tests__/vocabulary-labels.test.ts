import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shortCaseId, subjectLabelOf, subjectRefOf } from '../components/subjectRef'
import { mapProcessListRow } from '../components/processTypes'
import { autoDispositionBlockMessageKey } from '../components/proposalCaseStatus'
import { autoDispositionBlockValues } from '../data/validators'

const MODULE_ROOT = join(__dirname, '..')
const LOCALES = ['en', 'pl', 'de', 'es'] as const

function loadLocale(locale: (typeof LOCALES)[number]): Record<string, string> {
  return JSON.parse(readFileSync(join(MODULE_ROOT, 'i18n', `${locale}.json`), 'utf8'))
}

const catalogs = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocale(locale)])) as Record<
  (typeof LOCALES)[number],
  Record<string, string>
>

describe('enum label maps (consistency pass Area 4)', () => {
  const ENUM_KEYS = [
    'agent_orchestrator.agents.list.runtime.native',
    'agent_orchestrator.traces.detail.guardrailPhase.input',
    'agent_orchestrator.traces.detail.guardrailPhase.output',
    'agent_orchestrator.traces.detail.guardrailResult.pass',
    'agent_orchestrator.traces.detail.guardrailResult.warn',
    'agent_orchestrator.traces.detail.guardrailResult.block',
    'agent_orchestrator.traces.detail.toolStatus.ok',
    'agent_orchestrator.traces.detail.toolStatus.error',
  ]

  it.each(LOCALES)('%s carries every enum label key with a non-empty value', (locale) => {
    for (const key of ENUM_KEYS) {
      expect(catalogs[locale][key]).toEqual(expect.any(String))
      expect(catalogs[locale][key].trim().length).toBeGreaterThan(0)
    }
  })

  it('trace detail renders guardrail phase/result and tool status through t()', () => {
    const source = readFileSync(join(MODULE_ROOT, 'backend/traces/[id]/page.tsx'), 'utf8')
    expect(source).toContain('agent_orchestrator.traces.detail.guardrailPhase.${check.phase}')
    expect(source).toContain('agent_orchestrator.traces.detail.guardrailResult.${check.result}')
    expect(source).toContain("agent_orchestrator.traces.detail.toolStatus.${toolCall.status ?? 'ok'}")
  })

  it('titleCase-fallback key families are complete in all locales', () => {
    const FAMILIES = [
      ['agent_orchestrator.agents.list.autonomy.', ['auto', 'gated', 'review']],
      ['agent_orchestrator.agents.list.status.', ['good', 'new', 'poor', 'watch']],
      ['agent_orchestrator.agents.list.runtime.', ['external', 'in-process', 'native', 'opencode']],
      ['agent_orchestrator.agentDetail.outcome.', ['applied', 'failed', 'overridden', 'pending']],
      ['agent_orchestrator.disposition.', ['approved', 'auto_approved', 'edited', 'pending', 'rejected']],
    ] as const
    for (const locale of LOCALES) {
      for (const [prefix, members] of FAMILIES) {
        for (const member of members) {
          expect(catalogs[locale][`${prefix}${member}`]).toEqual(expect.any(String))
        }
      }
    }
  })

  it('interpolation tokens survive the PL/DE/ES retranslations', () => {
    for (const locale of LOCALES) {
      expect(catalogs[locale]['agent_orchestrator.caseload.inbox.guardrailFlagged']).toContain('{kind}')
      expect(catalogs[locale]['agent_orchestrator.caseload.inbox.guardrailFlagged']).toContain('{result}')
      expect(catalogs[locale]['agent_orchestrator.process.stepDisposed']).toContain('{disposition}')
    }
  })
})

describe('subjectRefOf (consistency pass Area 5)', () => {
  it('probes the legacy keys first, then the generic subject keys', () => {
    expect(subjectRefOf({ claimId: 'CLM-1', subjectId: 'SUB-1' })).toBe('CLM-1')
    expect(subjectRefOf({ deal_id: 'DEAL-9', ref: 'R-1' })).toBe('DEAL-9')
    expect(subjectRefOf({ reference: 'REF-2', subject_id: 'SUB-2' })).toBe('REF-2')
    expect(subjectRefOf({ subjectId: 'SUB-3' })).toBe('SUB-3')
    expect(subjectRefOf({ subject_id: 'SUB-4' })).toBe('SUB-4')
    expect(subjectRefOf({ ref: 'R-5' })).toBe('R-5')
  })

  it('skips blank values and rejects non-object inputs', () => {
    expect(subjectRefOf({ claimId: '  ', subjectId: 'SUB-1' })).toBe('SUB-1')
    expect(subjectRefOf({ claimId: 42, reference: 'REF-1' })).toBe('REF-1')
    expect(subjectRefOf(null)).toBeNull()
    expect(subjectRefOf('CLM-1')).toBeNull()
    expect(subjectRefOf(['CLM-1'])).toBeNull()
    expect(subjectRefOf({})).toBeNull()
  })

  it('is the single probe implementation — no page keeps its own claims key-sniffing', () => {
    const pages = [
      'backend/audit/page.tsx',
      'backend/overview/page.tsx',
      'backend/caseload/page.tsx',
      // The agent detail run-row sniffing moved into the shared workspace helper
      // (2026-07-24 agent-centric-workspace-and-eval-consolidation).
      'backend/agents/[id]/components/workspaceShared.ts',
    ]
    for (const page of pages) {
      const source = readFileSync(join(MODULE_ROOT, page), 'utf8')
      // `subjectLabelOf` is the probe plus its fallback; either entry point is
      // the shared implementation, a locally re-rolled one is not.
      expect(source).toMatch(/subject(RefOf|LabelOf)\(/)
      expect(source).not.toMatch(/fieldOf\([^)]*'claimId'/)
    }
  })
})

/**
 * Issue #5979 part 2: a truncated UUID was rendering where a subject name
 * belongs. `subjectRefOf` returning null is not a loading state — an agent
 * whose input declares no reference has no subject, and no later fetch invents
 * one — so the fallback is permanent and has to read as a case reference.
 */
describe('shortCaseId / subjectLabelOf (issue #5979)', () => {
  it('cuts on the UUID group boundary, so no dangling separator survives', () => {
    expect(shortCaseId('3b895091-dcd4-4a1f-9f0e-1c2d3e4f5a6b')).toBe('3B895091')
    expect(shortCaseId(null)).toBe('')
    expect(shortCaseId('  ')).toBe('')
  })

  it('prefers the declared reference and falls back to the short case id', () => {
    expect(subjectLabelOf({ claimId: 'CLM-1' }, '3b895091-dcd4-4a1f-9f0e-1c2d3e4f5a6b')).toBe('CLM-1')
    expect(subjectLabelOf({}, '3b895091-dcd4-4a1f-9f0e-1c2d3e4f5a6b')).toBe('3B895091')
  })

  it('renders the same short id the processes list searches on', () => {
    const row = mapProcessListRow({
      workflow_instance_id: '3b895091-dcd4-4a1f-9f0e-1c2d3e4f5a6b',
      status: 'running',
    })

    expect(row?.subjectLabel).toBe(shortCaseId('3b895091-dcd4-4a1f-9f0e-1c2d3e4f5a6b'))
  })

  it('no cockpit surface truncates an id mid-group any more', () => {
    const pages = [
      'backend/audit/page.tsx',
      'backend/overview/page.tsx',
      'backend/caseload/page.tsx',
      'backend/processes/[id]/page.tsx',
      'backend/agents/[id]/components/workspaceShared.ts',
      'backend/agents/[id]/components/EvaluationTab.tsx',
      'backend/agents/[id]/components/RunEvaluationDrawer.tsx',
    ]
    for (const page of pages) {
      expect(readFileSync(join(MODULE_ROOT, page), 'utf8')).not.toMatch(/slice\(0,\s*12\)/)
    }
  })
})

describe('neutral vocabulary (Q5 sweep)', () => {
  it('no locale value carries insurance-claims vocabulary', () => {
    // The sweep neutralized "claim/claimed/policyholder"; internal identifiers
    // and i18n key IDs (e.g. *.col.claim) deliberately keep their names — only
    // rendered VALUES are asserted here.
    const banned = /\b(claims?|claimed|policyholder|versicherungsnehmer|reclamaci[oó]n|reclamado|asegurado|roszczeni\w*|ubezpieczon\w*)\b/i
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        if (typeof value !== 'string') continue
        expect({ locale, key, ok: !banned.test(value) }).toEqual({ locale, key, ok: true })
      }
    }
  })

  it('PL uses the unified decision vocabulary', () => {
    const pl = catalogs.pl
    expect(pl['agent_orchestrator.caseload.view.inbox']).toBe('Skrzynka')
    expect(pl['agent_orchestrator.caseload.inbox.guardrailFlagged']).toBe('Zabezpieczenie {kind}: {result}')
    expect(pl['agent_orchestrator.audit.emptyDescription']).not.toMatch(/dyspozycj/i)
    expect(pl['agent_orchestrator.process.stepDisposed']).toMatch(/^Zdecydowano/)
    expect(pl['agent_orchestrator.process.disposes']).toBe('Decyduje')
  })
})

/**
 * A proposal held for a human must say WHY.
 *
 * Only `near_tie` was ever rendered, so a proposal held by the tenant's risk
 * ceiling, a failed guardrail, a missing trace or the policy switch looked like a
 * queue that had simply stopped — and the operator read it as "the confidence
 * threshold was not met", which is the one thing that had in fact passed. This
 * guards the mapping AND its translations together: a new block value that
 * nobody wrote copy for fails here rather than shipping as silence.
 */
describe('auto-disposition block reasons', () => {
  it('maps every stored value to a message key present in every locale', () => {
    for (const block of autoDispositionBlockValues) {
      const key = autoDispositionBlockMessageKey(block)
      expect(key).toEqual(expect.any(String))
      for (const locale of LOCALES) {
        expect(catalogs[locale][key as string]).toEqual(expect.any(String))
        expect(catalogs[locale][key as string].trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('returns null for a value this build does not recognise, rather than guessing', () => {
    expect(autoDispositionBlockMessageKey('a_reason_from_a_newer_build')).toBeNull()
    expect(autoDispositionBlockMessageKey(null)).toBeNull()
    expect(autoDispositionBlockMessageKey(undefined)).toBeNull()
  })
})
