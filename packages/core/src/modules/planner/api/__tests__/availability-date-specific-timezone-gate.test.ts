/** @jest-environment node */

/**
 * The self-service 403 gate in `POST /api/planner/availability-date-specific`
 * (#5862): a caller without `canManageAll`/`canManageUnavailability` must not
 * overwrite a date an administrator blocked. Which date a stored block covers
 * is read in the block's own zone, so the verdict is the same on every host.
 * Run on both CI timezone legs (`test` and `test:tz`).
 */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const subjectId = '33333333-3333-4333-8333-333333333333'
const actorId = '44444444-4444-4444-8444-444444444444'

const commandBusExecuteMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const parseScopedCommandInputMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
    if (name === 'em') return {}
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: actorId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: organizationId, filterIds: [organizationId] })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? 'error' })),
}))

jest.mock('@open-mercato/shared/lib/api/scoped', () => ({
  parseScopedCommandInput: (...args: unknown[]) => parseScopedCommandInputMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('../access', () => {
  const actual = jest.requireActual('../access')
  return {
    ...actual,
    assertAvailabilityWriteAccess: jest.fn(async () => ({
      canManageAll: false,
      canManageSelf: true,
      canManageUnavailability: false,
      memberId: subjectId,
      tenantId,
      organizationId,
    })),
  }
})

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false })),
  runCrudMutationGuardAfterSuccess: jest.fn(),
}))

import { POST as replaceDateSpecific } from '../availability-date-specific'

// Administrator-created full-day block for 15 June in Auckland: local midnight
// (+12) is 12:00Z on the 14th, a different date on any host west of UTC+12.
const aucklandBlockOnJune15 = {
  id: 'block-15',
  tenantId,
  organizationId,
  subjectType: 'member',
  subjectId,
  timezone: 'Pacific/Auckland',
  rrule: 'DTSTART:20260614T120000Z\nDURATION:PT24H\nRRULE:FREQ=DAILY;COUNT=1',
  exdates: [],
  kind: 'unavailability',
  deletedAt: null,
}

function selfServiceInput(date: string) {
  return {
    tenantId,
    organizationId,
    subjectType: 'member' as const,
    subjectId,
    timezone: 'Pacific/Auckland',
    dates: [date],
    windows: [{ start: '09:00', end: '17:00' }],
    kind: 'availability',
    isAvailable: true,
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/planner/availability-date-specific', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe(`date-specific replace self-service gate (host TZ=${process.env.TZ ?? 'unset'})`, () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findWithDecryptionMock.mockResolvedValue([aucklandBlockOnJune15])
    commandBusExecuteMock.mockResolvedValue({ logEntry: null })
  })

  it('refuses the local date an administrator blocked, without running the command', async () => {
    const input = selfServiceInput('2026-06-15')
    parseScopedCommandInputMock.mockReturnValue(input)

    const response = await replaceDateSpecific(makeRequest(input))

    expect(response.status).toBe(403)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('admits the neighbouring local date', async () => {
    const input = selfServiceInput('2026-06-14')
    parseScopedCommandInputMock.mockReturnValue(input)

    const response = await replaceDateSpecific(makeRequest(input))

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('planner.availability.date-specific.replace', expect.anything())
  })
})
