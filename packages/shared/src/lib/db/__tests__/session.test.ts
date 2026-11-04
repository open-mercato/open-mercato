import { buildPgSessionOptions, getPgSessionConfig, resolveDbSessionTimeZone } from '../session'

const env = (value?: string): NodeJS.ProcessEnv =>
  (value === undefined ? {} : { OM_DB_DEFAULT_TIMEZONE: value }) as NodeJS.ProcessEnv

describe('resolveDbSessionTimeZone', () => {
  it('returns undefined when the variable is unset', () => {
    expect(resolveDbSessionTimeZone(env())).toBeUndefined()
  })

  it('returns undefined when the variable is blank', () => {
    expect(resolveDbSessionTimeZone(env('   '))).toBeUndefined()
  })

  it('returns a valid IANA zone', () => {
    expect(resolveDbSessionTimeZone(env('UTC'))).toBe('UTC')
    expect(resolveDbSessionTimeZone(env(' Europe/Warsaw '))).toBe('Europe/Warsaw')
  })

  it('normalizes the letter case of the zone name', () => {
    expect(resolveDbSessionTimeZone(env('europe/warsaw'))).toBe('Europe/Warsaw')
  })

  it('passes current zone names through even when Intl reports a legacy alias', () => {
    expect(resolveDbSessionTimeZone(env('Asia/Kolkata'))).toBe('Asia/Kolkata')
    expect(resolveDbSessionTimeZone(env('Europe/Kyiv'))).toBe('Europe/Kyiv')
    expect(resolveDbSessionTimeZone(env('Asia/Ho_Chi_Minh'))).toBe('Asia/Ho_Chi_Minh')
  })

  it('sends an alias as its current zone name, which every tzdata build accepts', () => {
    expect(resolveDbSessionTimeZone(env('US/Eastern'))).toBe('America/New_York')
    expect(resolveDbSessionTimeZone(env('Asia/Calcutta'))).toBe('Asia/Kolkata')
  })

  it('rejects a UTC offset string, which Postgres would read with the opposite sign', () => {
    expect(() => resolveDbSessionTimeZone(env('+01:00'))).toThrow(/OM_DB_DEFAULT_TIMEZONE/)
  })

  it('throws a message naming the variable for an invalid zone', () => {
    expect(() => resolveDbSessionTimeZone(env('Mars/Olympus'))).toThrow(/OM_DB_DEFAULT_TIMEZONE="Mars\/Olympus"/)
  })
})

describe('buildPgSessionOptions', () => {
  it('returns undefined when nothing is set', () => {
    expect(buildPgSessionOptions({})).toBeUndefined()
    expect(buildPgSessionOptions({ idleSessionTimeoutMs: 0 })).toBeUndefined()
  })

  it('keeps the idle session timeout flag on its own', () => {
    expect(buildPgSessionOptions({ idleSessionTimeoutMs: 600000 })).toBe('-c idle_session_timeout=600000')
  })

  it('emits the time zone flag on its own', () => {
    expect(buildPgSessionOptions({ timeZone: 'Asia/Tokyo' })).toBe('-c TimeZone=Asia/Tokyo')
  })

  it('appends the time zone after the idle session timeout', () => {
    expect(buildPgSessionOptions({ idleSessionTimeoutMs: 600000, timeZone: 'UTC' })).toBe(
      '-c idle_session_timeout=600000 -c TimeZone=UTC',
    )
  })
})

describe('getPgSessionConfig', () => {
  it('adds no options key when the variable is unset, so pg keeps its defaults', () => {
    expect(getPgSessionConfig(env())).toEqual({})
  })

  it('sets the time zone option when the variable is present', () => {
    expect(getPgSessionConfig(env('America/New_York'))).toEqual({ options: '-c TimeZone=America/New_York' })
  })
})
