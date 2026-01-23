jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => undefined,
}))

import { z } from 'zod'
import { buildDealValidationError } from '../DealForm'

describe('buildDealValidationError', () => {
  const t = (key: string, fallback?: string) => fallback ?? key

  it('throws CrudFormError with message and field when available', () => {
    const issue: z.ZodIssue = {
      code: z.ZodIssueCode.custom,
      message: 'Title is required',
      path: ['title'],
    }
    const thrower = () => buildDealValidationError([issue], t)
    expect(thrower).toThrow('Title is required')
    try {
      thrower()
    } catch (error) {
      expect(error).toMatchObject({
        message: 'Title is required',
        fieldErrors: { title: 'Title is required' },
      })
    }
  })

  it('throws with fallback message when issue is missing', () => {
    const issue: z.ZodIssue = {
      code: z.ZodIssueCode.custom,
      message: undefined as unknown as string,
      path: [],
    }
    expect(() => buildDealValidationError([issue], t)).toThrow('Failed to save deal.')
  })
})
