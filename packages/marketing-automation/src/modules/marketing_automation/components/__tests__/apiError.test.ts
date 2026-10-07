import { readApiErrorField } from '../apiError'

describe('readApiErrorField', () => {
  it('reads the field where apiCallOrThrow puts it: on the error itself', () => {
    const error = Object.assign(new Error('Request failed'), { code: 'marketing_automation.validation.trailingWait', detail: 's1' })
    expect(readApiErrorField(error, 'code')).toBe('marketing_automation.validation.trailingWait')
    expect(readApiErrorField(error, 'detail')).toBe('s1')
  })

  it('falls back to a nested body, and answers null for anything else', () => {
    expect(readApiErrorField({ body: { code: 'x' } }, 'code')).toBe('x')
    expect(readApiErrorField(new Error('plain'), 'code')).toBeNull()
    expect(readApiErrorField(null, 'code')).toBeNull()
    expect(readApiErrorField({ code: 42 }, 'code')).toBeNull()
  })
})
