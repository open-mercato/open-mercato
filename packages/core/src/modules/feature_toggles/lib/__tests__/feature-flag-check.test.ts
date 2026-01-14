import { FeatureTogglesService } from '../feature-flag-check';
import { FeatureToggle, FeatureToggleOverride } from '../../data/entities';
import { CacheService } from '@open-mercato/cache';
import { EntityManager } from '@mikro-orm/core';

jest.mock('@open-mercato/cache');
jest.mock('../../data/entities');

describe('FeatureTogglesService', () => {
    let service: FeatureTogglesService;
    let mockCache: jest.Mocked<CacheService>;
    let mockEm: jest.Mocked<EntityManager>;

    const mockIdentifier = 'test-feature';
    const mockTenantId = 'tenant-123';

    beforeEach(() => {
        jest.clearAllMocks();

        mockCache = {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            deleteByTags: jest.fn(),
        } as unknown as jest.Mocked<CacheService>;

        mockEm = {
            findOne: jest.fn(),
        } as unknown as jest.Mocked<EntityManager>;

        service = new FeatureTogglesService(mockCache, mockEm);
    });

    describe('getBoolConfig (via isFeatureEnabled logic)', () => {
        it('should return cached value if present', async () => {
            const cachedValue = {
                valueType: 'boolean',
                value: true,
                source: 'default',
                toggleId: 'toggle-1',
                identifier: mockIdentifier,
                tenantId: mockTenantId,
            };
            mockCache.get.mockResolvedValue(cachedValue);

            const result = await service.getBoolConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toBe(true);
            }
            expect(mockCache.get).toHaveBeenCalledTimes(1);
            expect(mockEm.findOne).not.toHaveBeenCalled();
        });

        it('should throw when checking toggle fails (DB Error)', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

            mockCache.get.mockResolvedValue(null);
            mockEm.findOne.mockRejectedValue(new Error('DB Error'));

            await expect(service.getBoolConfig(mockIdentifier, mockTenantId)).rejects.toThrow('DB Error');

            warnSpy.mockRestore();
        });

        it('should return missing default when toggle not found', async () => {
            mockCache.get.mockResolvedValue(null);
            mockEm.findOne.mockResolvedValue(null);

            const result = await service.getBoolConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('MISSING_TOGGLE');
            }
        });

        it('should return default state if no override exists', async () => {
            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-1',
                identifier: mockIdentifier,
                defaultState: true,

                type: 'boolean',
                defaultValue: true
            };
            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(null);
                return Promise.resolve(null);
            });

            const result = await service.getBoolConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toBe(true);
                expect(result.resolution.source).toBe('default');
            }
            expect(mockCache.set).toHaveBeenCalled();
        });

        it('should return override state if override exists', async () => {
            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-1',
                identifier: mockIdentifier,
                defaultState: true,
                type: 'boolean'
            };
            const mockOverride = {
                value: false,
                source: 'override'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(mockOverride as any);
                return Promise.resolve(null);
            });

            const result = await service.getBoolConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toBe(false);
                expect(result.resolution.source).toBe('override');
            }
            expect(mockCache.set).toHaveBeenCalled();
        });

        it('should throw error when checking override fails', async () => {

            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-1',
                identifier: mockIdentifier,
                defaultState: false,

                type: 'boolean'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.reject(new Error('DB Error'));
                return Promise.resolve(null);
            });

            await expect(service.getBoolConfig(mockIdentifier, mockTenantId)).rejects.toThrow('DB Error');
        });

        it('should return INVALID_VALUE error if value is not boolean', async () => {
            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-invalid-val',
                identifier: mockIdentifier,
                defaultValue: "not-a-bool", // Invalid value for boolean type
                type: 'boolean'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(null);
                return Promise.resolve(null);
            });

            // Suppress console.error for this test
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const result = await service.getBoolConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('INVALID_VALUE');
                expect(result.error.expectedType).toBe('boolean');
            }

            errorSpy.mockRestore();
        });
    });

    describe('getStringConfig', () => {
        it('should return string value', async () => {
            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-str',
                identifier: mockIdentifier,
                defaultValue: "default string",
                type: 'string'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(null);
                return Promise.resolve(null);
            });

            const result = await service.getStringConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toBe("default string");
                expect(result.resolution.valueType).toBe('string');
            }
        });

        it('should return type mismatch error if toggle is boolean', async () => {
            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-bool',
                identifier: mockIdentifier,
                defaultState: true,
                type: 'boolean'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(null);
                return Promise.resolve(null);
            });

            // Suppress console.error for this test
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const result = await service.getStringConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('TYPE_MISMATCH');
                expect(result.error.expectedType).toBe('string');
                expect(result.error.actualType).toBe('boolean');
            }

            errorSpy.mockRestore();
        });
    });

    describe('getNumberConfig', () => {
        it('should return number value', async () => {
            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-num',
                identifier: mockIdentifier,
                defaultValue: 42,
                type: 'number'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(null);
                return Promise.resolve(null);
            });

            const result = await service.getNumberConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toBe(42);
                expect(result.resolution.valueType).toBe('number');
            }
        });

        it('should return type mismatch error if toggle is string', async () => {
            mockCache.get.mockResolvedValue(null);

            const mockToggle = {
                id: 'toggle-str',
                identifier: mockIdentifier,
                defaultValue: "not a number",
                type: 'string'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(null);
                return Promise.resolve(null);
            });

            // Suppress console.error for this test
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const result = await service.getNumberConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('TYPE_MISMATCH');
                expect(result.error.expectedType).toBe('number');
                expect(result.error.actualType).toBe('string');
            }

            errorSpy.mockRestore();
        });
    });

    describe('getJsonConfig', () => {
        it('should return json value', async () => {
            mockCache.get.mockResolvedValue(null);

            const defaultJson = { foo: "bar" };

            const mockToggle = {
                id: 'toggle-json',
                identifier: mockIdentifier,
                defaultValue: defaultJson,
                type: 'json'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(null);
                return Promise.resolve(null);
            });

            const result = await service.getJsonConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toEqual(defaultJson);
                expect(result.resolution.valueType).toBe('json');
            }
        });

        it('should successfully retrieve JSON override', async () => {
            mockCache.get.mockResolvedValue(null);

            const defaultJson = { foo: "default" };
            const overrideJson = { foo: "override" };

            const mockToggle = {
                id: 'toggle-json',
                identifier: mockIdentifier,
                defaultValue: defaultJson,
                type: 'json'
            };

            const mockOverride = {
                value: overrideJson,
                source: 'override'
            };

            mockEm.findOne.mockImplementation((entity) => {
                if (entity === FeatureToggle) return Promise.resolve(mockToggle as any);
                if (entity === FeatureToggleOverride) return Promise.resolve(mockOverride as any);
                return Promise.resolve(null);
            });

            const result = await service.getJsonConfig(mockIdentifier, mockTenantId);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toEqual(overrideJson);
                expect(result.resolution.source).toBe('override');
            }
        });
    });
});
