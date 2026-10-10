import { resolveSimulationWindow } from '../window'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('simulation window', () => {
  it('defaults to 90 days ending now and accepts { days }', () => {
    expect(resolveSimulationWindow(undefined, NOW)).toEqual({ from: new Date(NOW.getTime() - 90 * DAY), to: NOW })
    expect(resolveSimulationWindow({ days: 365 }, NOW)).toEqual({ from: new Date(NOW.getTime() - 365 * DAY), to: NOW })
    expect(resolveSimulationWindow({ days: 366 }, NOW)).toBeNull()
    expect(resolveSimulationWindow({ days: 0 }, NOW)).toBeNull()
  })

  it('accepts an absolute window of at most 365 days ending no later than now', () => {
    expect(resolveSimulationWindow({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }, NOW)).toEqual({ from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z') })
    expect(resolveSimulationWindow({ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, NOW)).toBeNull()
    expect(resolveSimulationWindow({ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, NOW)).toBeNull()
    expect(resolveSimulationWindow({ from: '2026-10-01T00:00:00Z', to: '2026-10-11T00:00:00Z' }, NOW)).toBeNull()
    expect(resolveSimulationWindow({ from: 'nope', to: '2026-10-01T00:00:00Z' }, NOW)).toBeNull()
  })
})
