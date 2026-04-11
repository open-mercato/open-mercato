import type { AwilixContainer } from 'awilix'
import { resolveRequestContext } from '../context'
import type { AuthContext } from '../../auth/server'
import { getAuthFromRequest } from '../../auth/server'
import { createRequestContainer } from '../../di/container'
import { resolveTranslations } from '../../i18n/server'

jest.mock('../../auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('../../di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../../i18n/server', () => ({
  resolveTranslations: jest.fn(),
}))

const createRequestContainerMock = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const getAuthFromRequestMock = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const resolveTranslationsMock = resolveTranslations as jest.MockedFunction<typeof resolveTranslations>

describe('resolveRequestContext', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('builds request context and seeds default organization scope from auth', async () => {
    const request = new Request('https://example.test/api/test')
    const container = {
      resolve: jest.fn(),
    } as unknown as AwilixContainer
    const auth: NonNullable<AuthContext> = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      roles: ['staff'],
    }
    const translate = jest.fn((key: string, fallback?: string) => fallback ?? key)

    createRequestContainerMock.mockResolvedValue(container)
    getAuthFromRequestMock.mockResolvedValue(auth)
    resolveTranslationsMock.mockResolvedValue({
      locale: 'en',
      dict: {},
      t: jest.fn(),
      translate,
    })

    const result = await resolveRequestContext(request)

    expect(createRequestContainerMock).toHaveBeenCalledTimes(1)
    expect(getAuthFromRequestMock).toHaveBeenCalledWith(request)
    expect(resolveTranslationsMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ctx: {
        container,
        auth,
        selectedOrganizationId: 'org-1',
        organizationIds: ['org-1'],
        translate,
      },
    })
  })

  it('returns null organization scope when auth is missing', async () => {
    const request = new Request('https://example.test/api/test')
    const container = {
      resolve: jest.fn(),
    } as unknown as AwilixContainer
    const translate = jest.fn((key: string, fallback?: string) => fallback ?? key)

    createRequestContainerMock.mockResolvedValue(container)
    getAuthFromRequestMock.mockResolvedValue(null)
    resolveTranslationsMock.mockResolvedValue({
      locale: 'en',
      dict: {},
      t: jest.fn(),
      translate,
    })

    const result = await resolveRequestContext(request)

    expect(result).toEqual({
      ctx: {
        container,
        auth: null,
        selectedOrganizationId: null,
        organizationIds: null,
        translate,
      },
    })
  })
})
