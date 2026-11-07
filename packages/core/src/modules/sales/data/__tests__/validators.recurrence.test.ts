import { recurrenceInputSchema } from '../validators'

describe('recurrenceInputSchema', () => {
  it('accepts a monthly recurrence with a period count', () => {
    expect(recurrenceInputSchema.parse({ frequency: 'monthly', startsOn: '2026-10-01', periodCount: '24' })).toEqual({
      frequency: 'monthly',
      startsOn: '2026-10-01',
      periodCount: 24,
    })
  })

  it('accepts an open-ended recurrence with an anchor that clamps onto the start date', () => {
    expect(
      recurrenceInputSchema.safeParse({ frequency: 'monthly', startsOn: '2027-04-30', anchorDay: 31, periodCount: null })
        .success,
    ).toBe(true)
  })

  it.each([
    [{ frequency: 'daily', startsOn: '2026-10-01' }, 'frequency'],
    [{ frequency: 'monthly', startsOn: '2026-02-30' }, 'startsOn'],
    [{ frequency: 'monthly', startsOn: '01.10.2026' }, 'startsOn'],
    [{ frequency: 'monthly', startsOn: '2026-10-01', periodCount: 0 }, 'periodCount'],
    [{ frequency: 'monthly', startsOn: '2026-10-01', periodCount: 1.5 }, 'periodCount'],
    [{ frequency: 'monthly', startsOn: '2026-10-15', anchorDay: 31 }, 'anchorDay'],
    [{ frequency: 'weekly', startsOn: '2026-10-15', anchorDay: 15 }, 'anchorDay'],
  ])('rejects %j on %s', (input, path) => {
    const result = recurrenceInputSchema.safeParse(input)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(path)
  })
})
