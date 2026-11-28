import { stagePathPropsSchema } from '../stage-path'

const noop = () => undefined
const stages = [
  { id: 'new', label: 'New' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]
const base = { stages, currentStageId: 'review' }

function firstIssue(input: unknown) {
  const result = stagePathPropsSchema.safeParse(input)
  if (result.success) return null
  return result.error.issues[0]
}

describe('StagePath contract', () => {
  it('accepts a minimal path', () => {
    expect(stagePathPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a full path', () => {
    const result = stagePathPropsSchema.safeParse({
      stages: [
        { id: 'new', label: 'New', description: 'Record created', icon: 'inbox', meta: '2 days' },
        { id: 'review', label: 'Review', disabled: true, disabledReason: 'Assign an owner first' },
        { id: 'done', label: 'Done' },
      ],
      currentStageId: 'new',
      completedStageIds: ['new'],
      outcome: { label: 'Approved', tone: 'success', description: 'Signed off by the team lead' },
      onStageSelect: noop,
      pendingStageId: 'done',
      readOnly: false,
      orientation: 'vertical',
      appearance: 'markers',
      size: 'compact',
      overflow: 'collapse',
      variant: 'card',
      ariaLabel: 'Claim progress',
      status: 'ready',
    })
    expect(result.success).toBe(true)
  })

  it('requires at least two stages', () => {
    expect(stagePathPropsSchema.safeParse({ stages: [stages[0]], currentStageId: 'new' }).success).toBe(false)
  })

  it('rejects duplicate stage ids', () => {
    const issue = firstIssue({ stages: [stages[0], stages[0]], currentStageId: 'new' })
    expect(issue?.message).toBe('Stage ids must be unique')
    expect(issue?.path).toEqual(['stages'])
  })

  it('rejects a current stage that is not on the path', () => {
    const issue = firstIssue({ stages, currentStageId: 'missing' })
    expect(issue?.message).toBe('currentStageId must match a stage id')
    expect(issue?.path).toEqual(['currentStageId'])
  })

  it('rejects completed and pending ids that are not on the path', () => {
    expect(firstIssue({ ...base, completedStageIds: ['new', 'missing'] })?.path).toEqual(['completedStageIds'])
    expect(firstIssue({ ...base, pendingStageId: 'missing' })?.path).toEqual(['pendingStageId'])
  })

  it('rejects a disabled reason on an enabled stage', () => {
    const issue = firstIssue({
      stages: [{ id: 'new', label: 'New', disabledReason: 'Not yet' }, stages[1]],
      currentStageId: 'new',
    })
    expect(issue?.message).toBe('disabledReason requires disabled: true')
  })

  it('rejects icon names that are not kebab-case', () => {
    expect(
      stagePathPropsSchema.safeParse({ stages: [{ id: 'new', label: 'New', icon: 'CheckCircle' }, stages[1]], currentStageId: 'new' })
        .success,
    ).toBe(false)
  })

  it('rejects unknown tones, orientations, sizes, overflow modes and variants', () => {
    expect(stagePathPropsSchema.safeParse({ ...base, outcome: { label: 'Won', tone: 'info' } }).success).toBe(false)
    expect(stagePathPropsSchema.safeParse({ ...base, orientation: 'diagonal' }).success).toBe(false)
    expect(stagePathPropsSchema.safeParse({ ...base, size: 'large' }).success).toBe(false)
    expect(stagePathPropsSchema.safeParse({ ...base, overflow: 'wrap' }).success).toBe(false)
    expect(stagePathPropsSchema.safeParse({ ...base, variant: 'outlined' }).success).toBe(false)
  })

  it('accepts both appearances in the horizontal orientation and rejects a vertical bar', () => {
    expect(stagePathPropsSchema.safeParse({ ...base, appearance: 'bar' }).success).toBe(true)
    expect(stagePathPropsSchema.safeParse({ ...base, appearance: 'markers' }).success).toBe(true)
    expect(stagePathPropsSchema.safeParse({ ...base, appearance: 'dots' }).success).toBe(false)
    const issue = firstIssue({ ...base, orientation: 'vertical', appearance: 'bar' })
    expect(issue?.message).toBe('appearance "bar" requires the horizontal orientation')
    expect(issue?.path).toEqual(['appearance'])
  })

  it('rejects the warning tone for an outcome', () => {
    expect(stagePathPropsSchema.safeParse({ ...base, outcome: { label: 'On hold', tone: 'warning' } }).success).toBe(false)
  })

  it('rejects a stage select handler that is not a function', () => {
    expect(stagePathPropsSchema.safeParse({ ...base, onStageSelect: 'move' }).success).toBe(false)
  })
})
