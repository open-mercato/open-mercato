import { wizardPropsSchema } from '../wizard'

const steps = [
  { id: 'details', title: 'Details', state: 'complete' },
  { id: 'items', title: 'Items' },
  { id: 'review', title: 'Review', optional: true },
]
const handlers = {
  onNext: async () => true,
  onBack: () => undefined,
  onFinish: async () => undefined,
}

describe('Wizard contract', () => {
  it('accepts steps with an active step and required handlers', () => {
    expect(wizardPropsSchema.safeParse({ steps, activeStepId: 'items', ...handlers }).success).toBe(true)
  })

  it('accepts optional step selection and slots', () => {
    const result = wizardPropsSchema.safeParse({
      steps,
      activeStepId: 'items',
      ...handlers,
      onStepSelect: () => undefined,
      children: 'Step content',
      footer: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an activeStepId outside steps', () => {
    expect(wizardPropsSchema.safeParse({ steps, activeStepId: 'payment', ...handlers }).success).toBe(false)
  })

  it('rejects duplicate step ids and empty steps', () => {
    expect(wizardPropsSchema.safeParse({ steps: [steps[0], steps[0]], activeStepId: 'details', ...handlers }).success).toBe(
      false,
    )
    expect(wizardPropsSchema.safeParse({ steps: [], activeStepId: 'details', ...handlers }).success).toBe(false)
  })

  it.each(['onNext', 'onBack', 'onFinish'] as const)('requires %s', (handlerName) => {
    const { [handlerName]: removed, ...rest } = handlers
    expect(removed).toBeDefined()
    expect(wizardPropsSchema.safeParse({ steps, activeStepId: 'items', ...rest }).success).toBe(false)
  })

  it('rejects unknown step states', () => {
    expect(
      wizardPropsSchema.safeParse({ steps: [{ id: 'a', title: 'A', state: 'skipped' }], activeStepId: 'a', ...handlers })
        .success,
    ).toBe(false)
  })
})
