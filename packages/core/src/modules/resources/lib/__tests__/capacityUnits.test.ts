import { normalizeCapacityInput } from '../capacityUnits'
import { resourcesResourceCreateSchema } from '../../data/validators'

describe('normalizeCapacityInput', () => {
  it('maps empty input to null', () => {
    expect(normalizeCapacityInput(undefined)).toBeNull()
    expect(normalizeCapacityInput(null)).toBeNull()
    expect(normalizeCapacityInput('')).toBeNull()
    expect(normalizeCapacityInput('   ')).toBeNull()
  })

  it('keeps zero so server-side validation rejects it', () => {
    expect(normalizeCapacityInput(0)).toBe(0)
    expect(normalizeCapacityInput('0')).toBe(0)
  })

  it('converts numeric input to numbers', () => {
    expect(normalizeCapacityInput(4)).toBe(4)
    expect(normalizeCapacityInput('4')).toBe(4)
    expect(normalizeCapacityInput('-3')).toBe(-3)
    expect(normalizeCapacityInput('2.5')).toBe(2.5)
  })

  it('produces a payload that the create schema rejects for zero capacity', () => {
    const result = resourcesResourceCreateSchema.safeParse({
      name: 'Zero capacity',
      capacity: normalizeCapacityInput('0'),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'capacity')).toBe(true)
    }
  })
})
