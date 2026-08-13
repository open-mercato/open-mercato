/**
 * The browser-side contract of the deal-briefing workflow.
 *
 * The trigger widget cannot import `lib/seeds.ts` (it reaches the ORM) and must
 * not import the definition JSON (it would ship the whole graph to the browser),
 * so it holds its own copy of the ids it needs. These tests are what stop that
 * copy from drifting: a step renamed in the JSON without being renamed in the
 * contract would not break the build, it would silently reduce the widget's live
 * status line to a badge that never moves.
 */

import definition from '../examples/deal-briefing-workflow.json'
import {
  DEAL_BRIEFING_STEP_IDS,
  DEAL_BRIEFING_WORKFLOW_ID,
  resolveBriefRunPhase,
} from '../lib/deal-briefing-contract'
import { DEAL_BRIEFING_WORKFLOW_ID as SEEDED_WORKFLOW_ID } from '../lib/seeds'

describe('deal-briefing contract ids', () => {
  it('names the workflow the seeder writes', () => {
    expect(definition.workflowId).toBe(DEAL_BRIEFING_WORKFLOW_ID)
  })

  it('is the same id the seeder exports, not a second copy of the string', () => {
    expect(SEEDED_WORKFLOW_ID).toBe(DEAL_BRIEFING_WORKFLOW_ID)
  })

  it('names only steps that exist in the shipped definition', () => {
    const stepIds = new Set(definition.definition.steps.map((step) => step.stepId))
    for (const stepId of Object.values(DEAL_BRIEFING_STEP_IDS)) {
      expect(stepIds.has(stepId)).toBe(true)
    }
  })

  it('covers every step a run can pause or finish on', () => {
    const known = new Set<string>(Object.values(DEAL_BRIEFING_STEP_IDS))
    const unmapped = definition.definition.steps
      .filter((step) => step.stepType !== 'START' && step.stepType !== 'IF_ELSE')
      .map((step) => step.stepId)
      .filter((stepId) => !known.has(stepId))
    expect(unmapped).toEqual([])
  })
})

describe('resolveBriefRunPhase', () => {
  it('reports each agent step as its own phase', () => {
    expect(resolveBriefRunPhase('workflows.instance.started', 'prepare_brief')).toBe('briefing')
    expect(resolveBriefRunPhase('workflows.instance.started', 'call_chief')).toBe('calling')
    expect(resolveBriefRunPhase('workflows.instance.started', 'extract_tasks')).toBe('extracting')
    expect(resolveBriefRunPhase('workflows.instance.started', 'record_tasks')).toBe('extracting')
  })

  it('reads the END step, not the event id, when the run finishes', () => {
    // Every failure route of this workflow lands on the same visible END step, so
    // the run COMPLETES even when nobody answered the phone. Trusting the event
    // id here would announce a delivered briefing for a call that never
    // connected — the one mistake this function exists to prevent.
    expect(resolveBriefRunPhase('workflows.instance.completed', 'brief_failed')).toBe('failed')
    expect(resolveBriefRunPhase('workflows.instance.completed', 'brief_delivered')).toBe('completed')
  })

  it('falls back to the event id when the payload carries no step', () => {
    expect(resolveBriefRunPhase('workflows.instance.failed', null)).toBe('failed')
    expect(resolveBriefRunPhase('workflows.instance.cancelled', undefined)).toBe('failed')
    expect(resolveBriefRunPhase('workflows.instance.completed', null)).toBe('completed')
  })

  it('says nothing about events that carry no news', () => {
    expect(resolveBriefRunPhase('workflows.instance.started', null)).toBeNull()
    expect(resolveBriefRunPhase('workflows.instance.updated', 'start')).toBeNull()
  })
})
