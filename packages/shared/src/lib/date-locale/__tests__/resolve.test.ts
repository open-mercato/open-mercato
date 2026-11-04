import { readDateLocaleEnv, resolveDateLocaleSettings } from '../resolve'
import type { DateLocaleEnvDefaults } from '../types'

const noEnv: DateLocaleEnvDefaults = {
  locale: null,
  dateFormat: null,
  dateTimeFormat: null,
  timeFormat: null,
  timeZone: null,
  firstDayOfWeek: null,
}

describe('readDateLocaleEnv', () => {
  it('reads every bootstrap variable', () => {
    expect(
      readDateLocaleEnv({
        OM_DEFAULT_LOCALE: 'en-GB',
        OM_DEFAULT_TIMEZONE: 'europe/warsaw',
        OM_FIRST_DAY_OF_WEEK: 'monday',
        NEXT_PUBLIC_OM_DATE_FORMAT: 'DD.MM.YYYY',
        NEXT_PUBLIC_OM_DATE_TIME_FORMAT: 'dd.MM.yyyy HH:mm',
        NEXT_PUBLIC_OM_TIME_FORMAT: 'HH:mm',
      }),
    ).toEqual({
      locale: 'en-GB',
      dateFormat: 'dd.MM.yyyy',
      dateTimeFormat: 'dd.MM.yyyy HH:mm',
      timeFormat: 'HH:mm',
      timeZone: 'Europe/Warsaw',
      firstDayOfWeek: 1,
    })
  })

  it('keeps the legacy NEXT_PUBLIC_DATE_* aliases behind the OM ones', () => {
    expect(readDateLocaleEnv({ NEXT_PUBLIC_DATE_FORMAT: 'yyyy-MM-dd' }).dateFormat).toBe('yyyy-MM-dd')
    expect(
      readDateLocaleEnv({ NEXT_PUBLIC_DATE_FORMAT: 'yyyy-MM-dd', NEXT_PUBLIC_OM_DATE_FORMAT: 'dd/MM/yyyy' }).dateFormat,
    ).toBe('dd/MM/yyyy')
  })

  it('ignores invalid values instead of throwing', () => {
    expect(readDateLocaleEnv({ OM_DEFAULT_TIMEZONE: 'Mars/Olympus', OM_FIRST_DAY_OF_WEEK: '9' })).toEqual(noEnv)
  })
})

describe('resolveDateLocaleSettings', () => {
  it('falls back to locale-derived defaults when nothing is set', () => {
    const resolved = resolveDateLocaleSettings({ env: noEnv })
    expect(resolved).toMatchObject({ ...noEnv })
    expect(new Set(Object.values(resolved.sources))).toEqual(new Set(['fallback']))
  })

  it('uses env defaults when the tenant has no value', () => {
    const resolved = resolveDateLocaleSettings({ env: { ...noEnv, timeZone: 'UTC', dateFormat: 'yyyy-MM-dd' } })
    expect(resolved.timeZone).toBe('UTC')
    expect(resolved.sources.timeZone).toBe('env')
    expect(resolved.dateFormat).toBe('yyyy-MM-dd')
  })

  it('lets the tenant setting override env', () => {
    const resolved = resolveDateLocaleSettings({
      env: { ...noEnv, timeZone: 'UTC', firstDayOfWeek: 0 },
      tenant: { timeZone: 'Europe/Warsaw', firstDayOfWeek: 1 },
    })
    expect(resolved.timeZone).toBe('Europe/Warsaw')
    expect(resolved.sources.timeZone).toBe('tenant')
    expect(resolved.firstDayOfWeek).toBe(1)
    expect(resolved.sources.firstDayOfWeek).toBe('tenant')
  })

  it('lets the user timezone override the tenant and env', () => {
    const resolved = resolveDateLocaleSettings({
      env: { ...noEnv, timeZone: 'UTC' },
      tenant: { timeZone: 'Europe/Warsaw' },
      userTimeZone: 'Asia/Tokyo',
    })
    expect(resolved.timeZone).toBe('Asia/Tokyo')
    expect(resolved.sources.timeZone).toBe('user')
  })

  it('ignores an invalid user timezone', () => {
    const resolved = resolveDateLocaleSettings({ env: noEnv, tenant: { timeZone: 'UTC' }, userTimeZone: 'Nope/Zone' })
    expect(resolved.timeZone).toBe('UTC')
    expect(resolved.sources.timeZone).toBe('tenant')
  })

  it('derives the date-time pattern from the date and time patterns', () => {
    expect(resolveDateLocaleSettings({ env: noEnv, tenant: { dateFormat: 'dd.MM.yyyy', timeFormat: 'HH:mm' } }).dateTimeFormat).toBe(
      'dd.MM.yyyy HH:mm',
    )
    // A tenant date-only pin keeps the time on timestamps, in the locale's own short time (`p`).
    expect(resolveDateLocaleSettings({ env: noEnv, tenant: { dateFormat: 'dd.MM.yyyy' } }).dateTimeFormat).toBe('dd.MM.yyyy p')
    // An env-only date pin stays bare, as NEXT_PUBLIC_OM_DATE_FORMAT always rendered.
    expect(resolveDateLocaleSettings({ env: { ...noEnv, dateFormat: 'dd.MM.yyyy' } }).dateTimeFormat).toBe('dd.MM.yyyy')
  })

  it('derives timestamps from a tenant date pin rather than an env date-time pattern', () => {
    const resolved = resolveDateLocaleSettings({
      env: { ...noEnv, dateTimeFormat: 'yyyy-MM-dd HH:mm' },
      tenant: { dateFormat: 'dd.MM.yyyy' },
    })
    expect(resolved.dateTimeFormat).toBe('dd.MM.yyyy p')
    expect(resolved.sources.dateTimeFormat).toBe('tenant')
    expect(
      resolveDateLocaleSettings({ env: { ...noEnv, dateTimeFormat: 'yyyy-MM-dd HH:mm' }, tenant: { dateFormat: 'dd.MM.yyyy', timeFormat: 'HH:mm' } })
        .dateTimeFormat,
    ).toBe('dd.MM.yyyy HH:mm')
  })

  it('keeps an env date-time pattern when the date pattern also comes from env', () => {
    const resolved = resolveDateLocaleSettings({ env: { ...noEnv, dateFormat: 'dd.MM.yyyy', dateTimeFormat: 'yyyy-MM-dd HH:mm' } })
    expect(resolved.dateTimeFormat).toBe('yyyy-MM-dd HH:mm')
    expect(resolved.sources.dateTimeFormat).toBe('env')
  })

  it('keeps an explicit date-time pattern over the derived one', () => {
    const resolved = resolveDateLocaleSettings({
      env: noEnv,
      tenant: { dateFormat: 'dd.MM.yyyy', dateTimeFormat: 'yyyy-MM-dd HH:mm' },
    })
    expect(resolved.dateTimeFormat).toBe('yyyy-MM-dd HH:mm')
    expect(resolved.sources.dateTimeFormat).toBe('tenant')
  })
})

describe('invalid patterns', () => {
  it('drops env patterns that date-fns cannot render', () => {
    const env = readDateLocaleEnv({ NEXT_PUBLIC_OM_DATE_FORMAT: 'D.M.YYYY', NEXT_PUBLIC_OM_TIME_FORMAT: 'HH:mm f' })
    expect(env.dateFormat).toBeNull()
    expect(env.timeFormat).toBeNull()
  })

  it('falls back from an invalid env pattern to the legacy alias', () => {
    expect(readDateLocaleEnv({ NEXT_PUBLIC_OM_DATE_FORMAT: 'dd<MM', NEXT_PUBLIC_DATE_FORMAT: 'yyyy-MM-dd' }).dateFormat).toBe('yyyy-MM-dd')
  })

  it('ignores an invalid stored tenant pattern', () => {
    expect(resolveDateLocaleSettings({ env: noEnv, tenant: { dateFormat: 'D.M.yyyy' } }).dateFormat).toBeNull()
  })

  it('ignores a stored or env locale with a calendar extension', () => {
    expect(resolveDateLocaleSettings({ env: noEnv, tenant: { locale: 'th-TH-u-ca-buddhist' } }).locale).toBeNull()
    expect(resolveDateLocaleSettings({ env: { OM_DEFAULT_LOCALE: 'en-US-u-ca-islamic' } }).locale).toBeNull()
  })
})
