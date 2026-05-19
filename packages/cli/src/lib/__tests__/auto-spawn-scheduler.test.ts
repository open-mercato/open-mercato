import {
  resolveAutoSpawnSchedulerEnabled,
  resolveAutoSpawnSchedulerLazy,
  resolveAutoSpawnSchedulerMode,
  resolveLazySchedulerPollMs,
  resolveLazySchedulerRestart,
} from '../auto-spawn-scheduler'

describe('auto scheduler spawn env resolution', () => {
  it('defaults to eager scheduler auto-spawn', () => {
    expect(resolveAutoSpawnSchedulerMode({})).toBe('eager')
    expect(resolveAutoSpawnSchedulerEnabled({})).toBe(true)
    expect(resolveAutoSpawnSchedulerLazy({})).toBe(false)
  })

  it('returns off when AUTO_SPAWN_SCHEDULER=false', () => {
    expect(resolveAutoSpawnSchedulerMode({ AUTO_SPAWN_SCHEDULER: 'false' })).toBe('off')
  })

  it('returns off when OM_AUTO_SPAWN_SCHEDULER=false and legacy unset', () => {
    expect(resolveAutoSpawnSchedulerMode({ OM_AUTO_SPAWN_SCHEDULER: 'false' })).toBe('off')
  })

  it('legacy AUTO_SPAWN_SCHEDULER=true wins over OM_AUTO_SPAWN_SCHEDULER=false', () => {
    expect(resolveAutoSpawnSchedulerMode({
      AUTO_SPAWN_SCHEDULER: 'true',
      OM_AUTO_SPAWN_SCHEDULER: 'false',
    })).toBe('eager')
  })

  it('returns lazy when scheduler is enabled and OM_AUTO_SPAWN_SCHEDULER_LAZY=true', () => {
    expect(resolveAutoSpawnSchedulerMode({
      AUTO_SPAWN_SCHEDULER: 'true',
      OM_AUTO_SPAWN_SCHEDULER_LAZY: 'true',
    })).toBe('lazy')
  })

  it('lazy is ignored when AUTO_SPAWN_SCHEDULER=false', () => {
    expect(resolveAutoSpawnSchedulerMode({
      AUTO_SPAWN_SCHEDULER: 'false',
      OM_AUTO_SPAWN_SCHEDULER_LAZY: 'true',
    })).toBe('off')
  })

  it('treats invalid AUTO_SPAWN_SCHEDULER values as default', () => {
    expect(resolveAutoSpawnSchedulerMode({ AUTO_SPAWN_SCHEDULER: 'maybe' })).toBe('eager')
  })

  it('resolves and clamps the lazy scheduler poll interval', () => {
    expect(resolveLazySchedulerPollMs({})).toBe(1000)
    expect(resolveLazySchedulerPollMs({ OM_AUTO_SPAWN_SCHEDULER_LAZY_POLL_MS: '500' })).toBe(500)
    expect(resolveLazySchedulerPollMs({ OM_AUTO_SPAWN_SCHEDULER_LAZY_POLL_MS: '50' })).toBe(250)
    expect(resolveLazySchedulerPollMs({ OM_AUTO_SPAWN_SCHEDULER_LAZY_POLL_MS: 'abc' })).toBe(1000)
    expect(resolveLazySchedulerPollMs({ OM_AUTO_SPAWN_SCHEDULER_LAZY_POLL_MS: '0' })).toBe(1000)
  })

  it('defaults lazy scheduler restart to enabled', () => {
    expect(resolveLazySchedulerRestart({})).toBe(true)
    expect(resolveLazySchedulerRestart({ OM_AUTO_SPAWN_SCHEDULER_LAZY_RESTART: 'false' })).toBe(false)
    expect(resolveLazySchedulerRestart({ OM_AUTO_SPAWN_SCHEDULER_LAZY_RESTART: 'true' })).toBe(true)
    expect(resolveLazySchedulerRestart({ OM_AUTO_SPAWN_SCHEDULER_LAZY_RESTART: 'maybe' })).toBe(true)
  })
})
