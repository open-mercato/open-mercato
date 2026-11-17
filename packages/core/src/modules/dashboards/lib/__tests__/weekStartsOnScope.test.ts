import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import type { DateLocaleSettingsInput } from '@open-mercato/shared/lib/date-locale/types'
import { resolveWeekStartsOnScope } from '../weekStartsOnScope'

const resolveForScopeMock = jest.fn()

jest.mock('@open-mercato/shared/lib/date-locale/registry', () => ({
  resolveDateLocaleSettingsForScope: (...args: unknown[]) => resolveForScopeMock(...args),
}))

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }
const container = { resolve: jest.fn() }
const settings = (tenant: DateLocaleSettingsInput) => resolveDateLocaleSettings({ tenant, env: noEnv })

describe('resolveWeekStartsOnScope', () => {
  beforeEach(() => resolveForScopeMock.mockReset())

  it('is empty under the Monday default so widget cache keys stay unchanged', async () => {
    resolveForScopeMock.mockResolvedValue(settings({}))
    await expect(resolveWeekStartsOnScope(container, 'tenant-1')).resolves.toEqual({})
    expect(resolveForScopeMock).toHaveBeenCalledWith(container, { tenantId: 'tenant-1' })
  })

  it('carries the configured first day of week', async () => {
    resolveForScopeMock.mockResolvedValue(settings({ firstDayOfWeek: 6 }))
    await expect(resolveWeekStartsOnScope(container, 'tenant-1')).resolves.toEqual({ weekStartsOn: 6 })
  })

  it("carries the formatting locale's week start when no day is configured", async () => {
    resolveForScopeMock.mockResolvedValue(settings({ locale: 'en-US' }))
    await expect(resolveWeekStartsOnScope(container, 'tenant-1')).resolves.toEqual({ weekStartsOn: 0 })
  })

  it('carries Monday explicitly when it comes from a Monday-first locale', async () => {
    resolveForScopeMock.mockResolvedValue(settings({ locale: 'en-GB' }))
    await expect(resolveWeekStartsOnScope(container, 'tenant-1')).resolves.toEqual({ weekStartsOn: 1 })
  })
})
