import { defaultScheduleTime } from '../ScheduleSendDialog'

const at = (h: number, m: number, s = 0) => new Date(2026, 5, 10, h, m, s, 0)

describe('defaultScheduleTime', () => {
  it.each([
    [at(22, 47), at(23, 0)],
    [at(22, 56), at(23, 30)],
    [at(22, 10), at(22, 30)],
    [at(22, 25), at(22, 30)],
    [at(22, 26), at(23, 0)],
    [at(22, 0), at(22, 30)],
    [at(23, 56), new Date(2026, 5, 11, 0, 30)],
  ])('rounds %s up to %s', (now, expected) => {
    expect(defaultScheduleTime(now).getTime()).toBe(expected.getTime())
  })

  it('keeps at least five minutes of lead with whole minutes', () => {
    const now = at(22, 25, 30)
    const result = defaultScheduleTime(now)
    expect(result.getTime() - now.getTime()).toBeGreaterThanOrEqual(5 * 60_000)
    expect(result.getSeconds()).toBe(0)
  })
})
