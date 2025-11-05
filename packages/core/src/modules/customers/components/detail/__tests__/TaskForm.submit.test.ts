jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { buildTaskSubmitPayload } from '../TaskForm'

describe('buildTaskSubmitPayload', () => {
  const t = (key: string, fallback?: string) => fallback ?? key

  it('throws when title is missing', () => {
    expect(() => buildTaskSubmitPayload({}, t)).toThrowError('Task name is required.')
  })

  it('returns normalized payload when title is provided', () => {
    const payload = buildTaskSubmitPayload({ title: '  Follow up  ', is_done: true, cf_priority: 'high' }, t)
    expect(payload).toEqual({
      base: { title: 'Follow up', is_done: true },
      custom: { priority: 'high' },
    })
  })
})
