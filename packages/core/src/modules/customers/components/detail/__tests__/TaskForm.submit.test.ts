jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { buildTaskSubmitPayload } from '../TaskForm'

describe('buildTaskSubmitPayload', () => {
  const t = (key: string, fallback?: string) => fallback ?? key

  it('throws when title is missing', () => {
    expect(() => buildTaskSubmitPayload({}, t)).toThrow('Task name is required.')
  })

  it('returns normalized payload with first-class task planning fields', () => {
    const payload = buildTaskSubmitPayload(
      {
        title: '  Follow up  ',
        is_done: true,
        description: '  Call the customer before Friday  ',
        priority: '42',
        scheduledAt: '2026-03-27T09:30:00.000Z',
        cf_severity: 'high',
      },
      t,
    )
    expect(payload).toEqual({
      base: {
        title: 'Follow up',
        is_done: true,
        description: 'Call the customer before Friday',
        priority: 42,
        scheduledAt: '2026-03-27T09:30:00.000Z',
      },
      custom: { severity: 'high' },
    })
  })

  it('throws when priority is outside the supported range', () => {
    expect(() => buildTaskSubmitPayload({ title: 'Follow up', priority: '101' }, t)).toThrow(
      'Enter a whole-number priority between 0 and 100.',
    )
  })
})
