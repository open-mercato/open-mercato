
export { }

import { FeatureToggle, FeatureToggleOverride } from '../../data/entities'

const registerCommand = jest.fn()
const invalidateIsEnabledCacheByKey = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({
    registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
    resolveTranslations: jest.fn().mockResolvedValue({
        translate: (_key: string, fallback?: string) => fallback ?? _key,
    }),
}))

jest.mock('../../lib/feature-flag-check', () => {
    return {
        invalidateIsEnabledCacheByKey
    }
})

describe('feature_toggles.overrides commands', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.resetModules()
    })

    describe('changeOverrideStateCommand', () => {
        it('reverts to inherit (deletes override)', async () => {
            let changeStateCommand: any
            jest.isolateModules(() => {
                require('../overrides')
                changeStateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.overrides.changeState')?.[0]
            })
            expect(changeStateCommand).toBeDefined()

            const existingToggle = {
                id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                identifier: 'test_feature',
            }

            const em = {
                fork: jest.fn().mockReturnThis(),
                nativeDelete: jest.fn(),
                flush: jest.fn().mockResolvedValue(undefined),
                findOne: jest.fn((entity, query) => {
                    if (query.id && Object.keys(query).length === 1) {
                        return existingToggle
                    }
                    return null
                }),
                resolve: jest.fn(),
                create: jest.fn((_ctor, data) => data),
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    if (token === 'featureTogglesService') return { invalidateIsEnabledCacheByKey }
                    return undefined
                }),
            }

            const ctx: any = { container }

            const input = {
                toggleId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
                isOverride: false,
            }

            const result = await changeStateCommand.execute(input, ctx)

            expect(result).toEqual({ overrideToggleId: null })
            expect(em.nativeDelete).toHaveBeenCalledWith(expect.any(Function), {
                toggle: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
            })
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
        })

        it('updates an existing override', async () => {
            let changeStateCommand: any
            jest.isolateModules(() => {
                require('../overrides')
                changeStateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.overrides.changeState')?.[0]
            })
            expect(changeStateCommand).toBeDefined()

            const existingOverride: any = {
                id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
                toggle: {
                    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                    identifier: 'test_feature',
                },
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
                value: 'enabled',
            }

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockResolvedValue(existingOverride),
                flush: jest.fn().mockResolvedValue(undefined),
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    if (token === 'featureTogglesService') return { invalidateIsEnabledCacheByKey }
                    return undefined
                }),
            }

            const ctx: any = { container }

            const input = {
                toggleId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
                overrideValue: 'disabled',
                isOverride: true,
            }

            const result = await changeStateCommand.execute(input, ctx)

            expect(result).toEqual({ overrideToggleId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33' })
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
        })

        it('creates a new override', async () => {
            let changeStateCommand: any
            jest.isolateModules(() => {
                require('../overrides')
                changeStateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.overrides.changeState')?.[0]
            })
            expect(changeStateCommand).toBeDefined()

            const newOverride = {
                id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
                toggle: {
                    identifier: 'test_feature'
                },
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
            }

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockReturnValue(newOverride),
                flush: jest.fn().mockResolvedValue(undefined),
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    if (token === 'featureTogglesService') return { invalidateIsEnabledCacheByKey }
                    return undefined
                }),
            }

            const ctx: any = { container }

            const input = {
                toggleId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
                overrideValue: 'enabled',
                isOverride: true,
            }

            const result = await changeStateCommand.execute(input, ctx)

            expect(result).toEqual({ overrideToggleId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33' })
            expect(em.create).toHaveBeenCalledWith(expect.any(Function), {
                toggle: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
                value: 'enabled'
            })
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
        })
    })
})
