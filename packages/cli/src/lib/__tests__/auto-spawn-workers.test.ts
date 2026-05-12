import {
  resolveAutoSpawnWorkersMode,
  resolveLazyPollMs,
  resolveLazyRestart,
} from '../auto-spawn-workers'

describe('resolveAutoSpawnWorkersMode', () => {
  it('defaults to eager when no env is set', () => {
    expect(resolveAutoSpawnWorkersMode({})).toBe('eager')
  })

  it('returns off when AUTO_SPAWN_WORKERS=false', () => {
    expect(resolveAutoSpawnWorkersMode({ AUTO_SPAWN_WORKERS: 'false' })).toBe('off')
  })

  it('returns off when OM_AUTO_SPAWN_WORKERS=false and legacy unset', () => {
    expect(resolveAutoSpawnWorkersMode({ OM_AUTO_SPAWN_WORKERS: 'false' })).toBe('off')
  })

  it('legacy AUTO_SPAWN_WORKERS=true wins over OM_AUTO_SPAWN_WORKERS=false', () => {
    expect(
      resolveAutoSpawnWorkersMode({
        AUTO_SPAWN_WORKERS: 'true',
        OM_AUTO_SPAWN_WORKERS: 'false',
      }),
    ).toBe('eager')
  })

  it('returns lazy when workers are enabled and OM_AUTO_SPAWN_WORKERS_LAZY=true', () => {
    expect(
      resolveAutoSpawnWorkersMode({
        AUTO_SPAWN_WORKERS: 'true',
        OM_AUTO_SPAWN_WORKERS_LAZY: 'true',
      }),
    ).toBe('lazy')
  })

  it('lazy is ignored when AUTO_SPAWN_WORKERS=false', () => {
    expect(
      resolveAutoSpawnWorkersMode({
        AUTO_SPAWN_WORKERS: 'false',
        OM_AUTO_SPAWN_WORKERS_LAZY: 'true',
      }),
    ).toBe('off')
  })

  it('treats invalid AUTO_SPAWN_WORKERS values as default', () => {
    expect(resolveAutoSpawnWorkersMode({ AUTO_SPAWN_WORKERS: 'maybe' })).toBe('eager')
  })

  it('falls through OM alias only when legacy is unset', () => {
    expect(resolveAutoSpawnWorkersMode({ OM_AUTO_SPAWN_WORKERS: 'true' })).toBe('eager')
    expect(
      resolveAutoSpawnWorkersMode({
        OM_AUTO_SPAWN_WORKERS: 'true',
        OM_AUTO_SPAWN_WORKERS_LAZY: 'true',
      }),
    ).toBe('lazy')
  })
})

describe('resolveLazyPollMs', () => {
  it('returns the default when unset', () => {
    expect(resolveLazyPollMs({})).toBe(1000)
  })

  it('parses numeric values', () => {
    expect(resolveLazyPollMs({ OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS: '500' })).toBe(500)
  })

  it('clamps to the minimum', () => {
    expect(resolveLazyPollMs({ OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS: '50' })).toBe(250)
  })

  it('falls back to default for non-numeric', () => {
    expect(resolveLazyPollMs({ OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS: 'abc' })).toBe(1000)
  })

  it('falls back to default for non-positive', () => {
    expect(resolveLazyPollMs({ OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS: '0' })).toBe(1000)
    expect(resolveLazyPollMs({ OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS: '-100' })).toBe(1000)
  })
})

describe('resolveLazyRestart', () => {
  it('defaults to true when unset', () => {
    expect(resolveLazyRestart({})).toBe(true)
  })

  it('returns false when explicitly disabled', () => {
    expect(resolveLazyRestart({ OM_AUTO_SPAWN_WORKERS_LAZY_RESTART: 'false' })).toBe(false)
  })

  it('returns true when explicitly enabled', () => {
    expect(resolveLazyRestart({ OM_AUTO_SPAWN_WORKERS_LAZY_RESTART: 'true' })).toBe(true)
  })

  it('falls back to default for invalid values', () => {
    expect(resolveLazyRestart({ OM_AUTO_SPAWN_WORKERS_LAZY_RESTART: 'maybe' })).toBe(true)
  })
})
