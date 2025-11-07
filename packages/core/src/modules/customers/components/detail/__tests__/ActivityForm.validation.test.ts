jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { z } from 'zod'
import { buildActivityValidationError } from '../ActivityForm'

describe('buildActivityValidationError', () => {
  const t = (key: string, fallback?: string) => fallback ?? key

  it('throws CrudFormError with field mapping when available', () => {
    const issue: z.ZodIssue = {
      code: z.ZodIssueCode.custom,
      message: 'Activity type is required',
      path: ['activityType'],
    }
    const thrower = () => buildActivityValidationError([issue], t)
    expect(thrower).toThrowError('Activity type is required')
    try {
      thrower()
    } catch (error) {
      expect(error).toMatchObject({
        message: 'Activity type is required',
        fieldErrors: { activityType: 'Activity type is required' },
      })
    }
  })

  it('uses fallback message when missing', () => {
    const issue: z.ZodIssue = {
      code: z.ZodIssueCode.custom,
      message: undefined as unknown as string,
      path: [],
    }
    expect(() => buildActivityValidationError([issue], t)).toThrowError('customers.people.detail.activities.error')
  })
})
