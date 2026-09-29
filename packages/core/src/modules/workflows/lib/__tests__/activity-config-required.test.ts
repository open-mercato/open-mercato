/**
 * @jest-environment node
 *
 * Guards #4232: activity configs were validated only for WAIT, so an activity
 * missing a field its executor requires (CALL_API `endpoint`, EMIT_EVENT
 * `eventName`, …) saved cleanly from the visual editor and only blew up when an
 * instance ran it — the "my edit silently disappeared and nothing told me why"
 * report. The schema now rejects them at edit/save time with the exact path.
 */
import { activityDefinitionSchema } from '../../data/validators'
import { humanizeDefinitionIssuePath } from '../format-validation-error'

function activity(activityType: string, config: Record<string, unknown>) {
  return {
    activityId: 'act_1',
    activityName: 'Test activity',
    activityType,
    config,
  }
}

describe('activityDefinitionSchema — required config per activity type (#4232)', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['CALL_API', {}, 'endpoint'],
    ['EMIT_EVENT', {}, 'eventName'],
    ['CALL_WEBHOOK', {}, 'url'],
    ['EXECUTE_FUNCTION', {}, 'functionName'],
    ['SEND_EMAIL', { to: 'a@b.c' }, 'subject'],
    ['UPDATE_ENTITY', { commandId: 'sales.documents.update' }, 'input'],
  ]

  it.each(cases)('rejects %s missing %s', (activityType, config, missingKey) => {
    const result = activityDefinitionSchema.safeParse(activity(activityType, config))
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues.find((candidate) => candidate.path.join('.') === `config.${missingKey}`)
    expect(issue?.message).toBe(`${activityType} activity requires "${missingKey}"`)
  })

  it('rejects a blank string as missing (whitespace-only endpoint)', () => {
    const result = activityDefinitionSchema.safeParse(activity('CALL_API', { endpoint: '   ' }))
    expect(result.success).toBe(false)
  })

  it('accepts activities whose required config is present', () => {
    expect(activityDefinitionSchema.safeParse(activity('CALL_API', { endpoint: '/api/x' })).success).toBe(true)
    expect(activityDefinitionSchema.safeParse(activity('EMIT_EVENT', { eventName: 'a.b.c' })).success).toBe(true)
    expect(
      activityDefinitionSchema.safeParse(
        activity('UPDATE_ENTITY', { commandId: 'sales.documents.update', input: { id: '1' } }),
      ).success,
    ).toBe(true)
  })

  it('leaves the existing WAIT duration/until rules intact', () => {
    expect(activityDefinitionSchema.safeParse(activity('WAIT', {})).success).toBe(false)
    expect(activityDefinitionSchema.safeParse(activity('WAIT', { duration: 'PT5M' })).success).toBe(true)
  })
})

describe('humanizeDefinitionIssuePath (#4232)', () => {
  it('renders collection indexes 1-based with recognizable labels', () => {
    expect(humanizeDefinitionIssuePath(['steps', 2, 'activities', 0, 'config', 'endpoint'])).toBe(
      'step 3 › activity 1 › config.endpoint',
    )
    expect(humanizeDefinitionIssuePath(['transitions', 0, 'toStepId'])).toBe('transition 1 › toStepId')
  })

  it('falls back sensibly for short and empty paths', () => {
    expect(humanizeDefinitionIssuePath(['workflowName'])).toBe('workflowName')
    expect(humanizeDefinitionIssuePath([])).toBe('definition')
  })
})
