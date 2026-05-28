import { resolveGenerateWatcherMode } from '../in-process-generate-watcher-mode'

describe('resolveGenerateWatcherMode', () => {
  it('defaults to in-process when the env var is unset', () => {
    expect(resolveGenerateWatcherMode({})).toBe('in-process')
  })

  it('defaults to in-process for empty / whitespace / unknown values', () => {
    expect(resolveGenerateWatcherMode({ OM_DEV_GENERATE_WATCH_MODE: '' })).toBe('in-process')
    expect(resolveGenerateWatcherMode({ OM_DEV_GENERATE_WATCH_MODE: '   ' })).toBe('in-process')
    expect(resolveGenerateWatcherMode({ OM_DEV_GENERATE_WATCH_MODE: 'maybe' })).toBe('in-process')
  })

  it.each(['legacy', 'LEGACY', 'sidecar', 'out-of-process', '  legacy  '])(
    'returns legacy for opt-out alias %p',
    (value) => {
      expect(resolveGenerateWatcherMode({ OM_DEV_GENERATE_WATCH_MODE: value })).toBe('legacy')
    },
  )
})
