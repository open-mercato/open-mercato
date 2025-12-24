export { }

import { FeatureToggle } from '../../data/entities'
import { CrudHttpError } from '@/lib/crud/errors'

const registerCommand = jest.fn()
const invalidateIsEnabledCacheByIdentifierTag = jest.fn().mockResolvedValue(undefined)

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
        invalidateIsEnabledCacheByIdentifierTag
    }
})

jest.mock('../../../customers/commands/shared', () => ({
    extractUndoPayload: jest.fn((logEntry) => logEntry?.payload?.undo),
}))



describe('feature_toggles.global commands', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.resetModules()
    })

    describe('createToggleCommand', () => {
        it('creates a feature toggle successfully', async () => {
            let createCommand: any
            jest.isolateModules(() => {
                require('../global')
                createCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.global.create')?.[0]
            })
            expect(createCommand).toBeDefined()

            const em = {
                fork: jest.fn().mockReturnThis(),
                create: jest.fn((_ctor, data) => ({ ...data, id: 'new-toggle-id' })),
                persist: jest.fn(),
                flush: jest.fn().mockResolvedValue(undefined),
                findOne: jest.fn(),
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    return undefined
                }),
            }

            const ctx: any = {
                container,
            }

            const input = {
                identifier: 'test_feature',
                name: 'Test Feature',
                description: 'A test feature toggle',
                category: 'testing',
                defaultState: true,
                failMode: 'fail_closed',
            }

            const result = await createCommand.execute(input, ctx)

            expect(result).toEqual({ toggleId: 'new-toggle-id' })
            expect(em.create).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
                identifier: 'test_feature',
                name: 'Test Feature',
                defaultState: true
            }))
            expect(em.persist).toHaveBeenCalled()
            expect(em.flush).toHaveBeenCalled()
        })

        it('undoes creation successfully including potential overrides', async () => {
            let createCommand: any
            jest.isolateModules(() => {
                require('../global')
                createCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.global.create')?.[0]
            })

            const toggleId = 'new-toggle-id'
            const existingToggle = {
                id: toggleId,
                identifier: 'test_feature',
            }

            const potentialOverrides = [{ id: 'o1' }]

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockResolvedValue(existingToggle),
                find: jest.fn().mockResolvedValue(potentialOverrides),
                remove: jest.fn(),
                flush: jest.fn().mockResolvedValue(undefined),
                resolve: jest.fn()
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    return undefined
                }),
            }

            const ctx: any = { container }
            const logEntry = { resourceId: toggleId }

            await createCommand.undo({ logEntry, ctx })

            expect(em.find).toHaveBeenCalledWith(expect.anything(), { toggle: toggleId })
            expect(em.remove).toHaveBeenCalledWith(potentialOverrides)
            expect(em.remove).toHaveBeenCalledWith(existingToggle)
            expect(em.flush).toHaveBeenCalled()
        })
    })

    describe('updateToggleCommand', () => {
        it('updates a feature toggle successfully', async () => {
            let updateCommand: any
            jest.isolateModules(() => {
                require('../global')
                updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.global.update')?.[0]
            })
            expect(updateCommand).toBeDefined()

            const existingToggle: any = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                identifier: 'test_feature',
                name: 'Old Name',
                defaultState: false,
            }

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockResolvedValue(existingToggle),
                flush: jest.fn().mockResolvedValue(undefined),
                resolve: jest.fn()
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    return undefined
                }),
            }

            const ctx: any = { container }

            const input = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: 'New Name',
                defaultState: true
            }

            const result = await updateCommand.execute(input, ctx)

            expect(result).toEqual({ toggleId: '123e4567-e89b-12d3-a456-426614174000' })
            expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { id: '123e4567-e89b-12d3-a456-426614174000' })
            expect(existingToggle.name).toBe('New Name')
            expect(existingToggle.defaultState).toBe(true)
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByIdentifierTag).toHaveBeenCalledWith('test_feature')
        })

        it('throws error when toggle not found', async () => {
            let updateCommand: any
            jest.isolateModules(() => {
                require('../global')
                updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.global.update')?.[0]
            })

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockResolvedValue(null),
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    return undefined
                }),
            }

            const ctx: any = { container }

            await expect(updateCommand.execute({ id: '123e4567-e89b-12d3-a456-426614174000' }, ctx)).rejects.toThrow('Toggle not found')
        })
    })

    describe('deleteToggleCommand', () => {
        it('deletes a feature toggle and its overrides successfully', async () => {
            let deleteCommand: any
            jest.isolateModules(() => {
                require('../global')
                deleteCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.global.delete')?.[0]
            })
            expect(deleteCommand).toBeDefined()

            const existingToggle = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                identifier: 'test_feature',
            }

            const existingOverrides = [
                { id: 'override-1', toggle: existingToggle, tenantId: 'tenant-1', state: 'enabled' },
                { id: 'override-2', toggle: existingToggle, tenantId: 'tenant-2', state: 'disabled' },
            ]

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockResolvedValue(existingToggle),
                find: jest.fn().mockResolvedValue(existingOverrides),
                remove: jest.fn(),
                flush: jest.fn().mockResolvedValue(undefined),
                create: jest.fn((_ctor, data) => data),
                persist: jest.fn(),
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    return undefined
                }),
            }

            const ctx: any = { container }

            const result = await deleteCommand.execute({ id: '123e4567-e89b-12d3-a456-426614174000' }, ctx)

            expect(result).toEqual({ toggleId: '123e4567-e89b-12d3-a456-426614174000' })
            expect(em.find).toHaveBeenCalledWith(expect.anything(), { toggle: '123e4567-e89b-12d3-a456-426614174000' })
            expect(em.remove).toHaveBeenCalledWith(existingOverrides)
            expect(em.remove).toHaveBeenCalledWith(existingToggle)
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByIdentifierTag).toHaveBeenCalledWith('test_feature')

            const prepareResult = await deleteCommand.prepare({ id: '123e4567-e89b-12d3-a456-426614174000' }, ctx)

            expect(prepareResult).toEqual({
                before: expect.objectContaining({ id: '123e4567-e89b-12d3-a456-426614174000' }),
                overrides: [
                    { id: 'override-1', toggleId: '123e4567-e89b-12d3-a456-426614174000', tenantId: 'tenant-1', state: 'enabled' },
                    { id: 'override-2', toggleId: '123e4567-e89b-12d3-a456-426614174000', tenantId: 'tenant-2', state: 'disabled' },
                ]
            })

            const logEntry = {
                payload: {
                    undo: {
                        before: {
                            id: '123e4567-e89b-12d3-a456-426614174000',
                            identifier: 'test_feature',
                            name: 'Test Feature',
                            defaultState: false,
                        },
                        overrides: [
                            { id: 'override-1', toggleId: '123e4567-e89b-12d3-a456-426614174000', tenantId: 'tenant-1', state: 'enabled' },
                        ]
                    }
                }
            }

            em.findOne.mockResolvedValue(null)
            em.create.mockClear()
            em.persist.mockClear()
            em.flush.mockClear()

            await deleteCommand.undo({ logEntry, ctx })

            expect(em.create).toHaveBeenCalledTimes(2)
            expect(em.persist).toHaveBeenCalledTimes(2)
            expect(em.flush).toHaveBeenCalled()
        })

        it('throws error when toggle not found', async () => {
            let deleteCommand: any
            jest.isolateModules(() => {
                require('../global')
                deleteCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.global.delete')?.[0]
            })

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockResolvedValue(null),
            }

            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    return undefined
                }),
            }

            const ctx: any = { container }

            await expect(deleteCommand.execute({ id: '123e4567-e89b-12d3-a456-426614174000' }, ctx)).rejects.toThrow('Feature toggle not found')
        })
    })
})
