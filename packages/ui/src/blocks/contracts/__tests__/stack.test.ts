import { inlinePropsSchema, stackPropsSchema } from '../stack'
import * as contracts from '..'

describe('Stack and Inline contracts', () => {
  it('accepts DS scale gaps only', () => {
    expect(stackPropsSchema.safeParse({ gap: 4 }).success).toBe(true)
    expect(stackPropsSchema.safeParse({ gap: 7 }).success).toBe(false)
    expect(stackPropsSchema.safeParse({ gap: '13px' }).success).toBe(false)
  })

  it('accepts alignment, justification and wrap', () => {
    expect(inlinePropsSchema.safeParse({ gap: 2, align: 'center', justify: 'between', wrap: true }).success).toBe(true)
    expect(inlinePropsSchema.safeParse({ justify: 'around' }).success).toBe(false)
  })

  it('has no status prop', () => {
    expect('status' in stackPropsSchema.shape).toBe(false)
  })

  it('exposes every contract from the barrel', () => {
    for (const name of [
      'entityHeaderPropsSchema',
      'keyValuePropsSchema',
      'timelinePropsSchema',
      'kanbanPropsSchema',
      'wizardPropsSchema',
      'stackPropsSchema',
      'inlinePropsSchema',
      'blockActionSchema',
    ]) {
      expect(contracts).toHaveProperty(name)
    }
  })
})
