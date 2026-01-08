import { isFeatureEnabled } from '../feature-flag-check'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { FeatureToggle, FeatureToggleOverride } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/di/container')
jest.mock('@open-mercato/cache')
jest.mock('../../data/entities')

type MockCacheService = {
    get: jest.Mock
    set: jest.Mock
    delete: jest.Mock
    deleteByTags: jest.Mock
}

type MockEntityManager = {
    findOne: jest.Mock
}

describe('isFeatureEnabled', () => {
    let mockContainer: { resolve: jest.Mock }
    let mockCache: MockCacheService
    let mockEm: MockEntityManager

    const mockIdentifier = 'test-feature'
    const mockTenantId = 'tenant-123'

    beforeEach(() => {
        jest.clearAllMocks()

        mockCache = {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            deleteByTags: jest.fn(),
        }

        mockEm = {
            findOne: jest.fn(),
        }

        mockContainer = {
            resolve: jest.fn((key: string) => {
                if (key === 'cache') return mockCache
                if (key === 'em') return mockEm
                return null
            }),
        }

            ; (createRequestContainer as jest.Mock).mockResolvedValue(mockContainer)
    })

    it('should return cached value if present', async () => {
        const cachedValue = {
            enabled: true,
            source: 'default',
            toggleId: 'toggle-1',
            identifier: mockIdentifier,
            tenantId: mockTenantId,
        }
        mockCache.get.mockResolvedValue(cachedValue)

        const result = await isFeatureEnabled(mockIdentifier, mockTenantId)

        expect(result.enabled).toBe(true)
        expect(mockCache.get).toHaveBeenCalledTimes(1)
        expect(mockEm.findOne).not.toHaveBeenCalled()
    })

    it('should return missing default when checking toggle fails (DB Error)', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { })

        mockCache.get.mockResolvedValue(null)
        mockEm.findOne.mockRejectedValue(new Error('DB Error'))

        const result = await isFeatureEnabled(mockIdentifier, mockTenantId)

        expect(result.enabled).toBe(false)
        expect(result.source).toBe('missing')

        expect(warnSpy).toHaveBeenCalled()
        warnSpy.mockRestore()
    })

    it('should return missing default when toggle not found', async () => {
        mockCache.get.mockResolvedValue(null)
        mockEm.findOne.mockResolvedValue(null)

        const result = await isFeatureEnabled(mockIdentifier, mockTenantId)

        expect(result.enabled).toBe(false)
        expect(result.source).toBe('missing')
    })

    it('should return default state if no override exists', async () => {
        mockCache.get.mockResolvedValue(null)

        const mockToggle = {
            id: 'toggle-1',
            identifier: mockIdentifier,
            defaultState: true,
            failMode: 'fail_closed'
        }
        mockEm.findOne.mockImplementation((entity) => {
            if (entity === FeatureToggle) return Promise.resolve(mockToggle)
            if (entity === FeatureToggleOverride) return Promise.resolve(null)
            return Promise.resolve(null)
        })

        const result = await isFeatureEnabled(mockIdentifier, mockTenantId)

        expect(result.enabled).toBe(true)
        expect(result.source).toBe('default')
        expect(mockCache.set).toHaveBeenCalled()
    })

    it('should return override state if override exists', async () => {
        mockCache.get.mockResolvedValue(null)

        const mockToggle = {
            id: 'toggle-1',
            identifier: mockIdentifier,
            defaultState: true,
        }
        const mockOverride = {
            state: 'disabled'
        }

        mockEm.findOne.mockImplementation((entity) => {
            if (entity === FeatureToggle) return Promise.resolve(mockToggle)
            if (entity === FeatureToggleOverride) return Promise.resolve(mockOverride)
            return Promise.resolve(null)
        })

        const result = await isFeatureEnabled(mockIdentifier, mockTenantId)

        expect(result.enabled).toBe(false)
        expect(result.source).toBe('override')
        expect(mockCache.set).toHaveBeenCalled()
    })

    it('should return fallback when checking override fails', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { })

        mockCache.get.mockResolvedValue(null)

        const mockToggle = {
            id: 'toggle-1',
            identifier: mockIdentifier,
            defaultState: false,
            failMode: 'fail_open'
        }

        mockEm.findOne.mockImplementation((entity) => {
            if (entity === FeatureToggle) return Promise.resolve(mockToggle)
            if (entity === FeatureToggleOverride) return Promise.reject(new Error('DB Error'))
            return Promise.resolve(null)
        })

        const result = await isFeatureEnabled(mockIdentifier, mockTenantId)

        expect(result.enabled).toBe(true)
        expect(result.source).toBe('fallback')
        expect(mockCache.set).toHaveBeenCalled()

        expect(warnSpy).toHaveBeenCalled()
        warnSpy.mockRestore()
    })
})
