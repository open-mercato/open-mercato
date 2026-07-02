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

  it('maps a dictionary status onto base.status and keeps is_done in sync for open statuses', () => {
    const payload = buildTaskSubmitPayload({ title: 'Wait on legal', status: 'waiting' }, t)
    expect(payload.base.status).toBe('waiting')
    expect(payload.base.is_done).toBe(false)
  })

  it('derives is_done=true when the chosen status is done', () => {
    const payload = buildTaskSubmitPayload({ title: 'Close it out', status: 'done' }, t)
    expect(payload.base.status).toBe('done')
    expect(payload.base.is_done).toBe(true)
  })

  it('falls back to the legacy is_done flag when no status is provided', () => {
    const payload = buildTaskSubmitPayload({ title: 'Legacy', is_done: true }, t)
    expect(payload.base.status).toBeUndefined()
    expect(payload.base.is_done).toBe(true)
  })
})
