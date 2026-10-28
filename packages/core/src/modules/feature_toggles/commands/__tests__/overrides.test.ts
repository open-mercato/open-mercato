
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { JsonValue } from '@open-mercato/shared/lib/json'
import type { FeatureToggle, FeatureToggleOverride } from '../../data/entities'
import type { ProcessedChangeOverrideStateInput } from '../../data/validators'

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
                findOne: jest.fn((_entity, query) => {
                    if (query.id === existingToggle.id && query.deletedAt === null) {
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
            const existingToggle = existingOverride.toggle

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn((_entity, query) => {
                    if (query.id === existingToggle.id && query.deletedAt === null) return Promise.resolve(existingToggle)
                    if (query.toggle === existingToggle.id && query.tenantId === existingOverride.tenantId) return Promise.resolve(existingOverride)
                    return Promise.resolve(null)
                }),
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

            const existingToggle = {
                id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                identifier: 'test_feature',
            }
            const newOverride = {
                id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
                toggle: existingToggle,
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
            }

            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn((_entity, query) => {
                    if (query.id === existingToggle.id && query.deletedAt === null) return Promise.resolve(existingToggle)
                    if (query.toggle === existingToggle.id) return Promise.resolve(null)
                    return Promise.resolve(null)
                }),
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
                toggle: existingToggle,
                tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
                value: 'enabled'
            })
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
        })
    })

    describe('changeOverrideStateCommand undo', () => {
        const toggleId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
        const tenantId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
        const overrideId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
        const loadedToggle = { id: toggleId, identifier: 'test_feature' }

        function loadCommand(): any {
            let changeStateCommand: any
            jest.isolateModules(() => {
                require('../overrides')
                changeStateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.overrides.changeState')?.[0]
            })
            expect(changeStateCommand).toBeDefined()
            return changeStateCommand
        }

        function buildContext(existingOverride: Record<string, unknown> | null) {
            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn((entity: { name: string }, query: Record<string, unknown>) => {
                    if (entity.name === 'FeatureToggle' && query.id === toggleId) return Promise.resolve(loadedToggle)
                    if (entity.name === 'FeatureToggleOverride' && query.toggle === toggleId && query.tenantId === tenantId) {
                        return Promise.resolve(existingOverride)
                    }
                    return Promise.resolve(null)
                }),
                create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data, toggle: { id: toggleId } })),
                nativeDelete: jest.fn().mockResolvedValue(1),
                flush: jest.fn().mockResolvedValue(undefined),
                begin: jest.fn().mockResolvedValue(undefined),
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                isInTransaction: jest.fn().mockReturnValue(false),
            }
            const container = {
                resolve: jest.fn((token: string) => {
                    if (token === 'em') return em
                    if (token === 'featureTogglesService') return { invalidateIsEnabledCacheByKey }
                    return undefined
                }),
            }
            return { em, ctx: { container } }
        }

        function undoLogEntry(before: Record<string, unknown>, after: Record<string, unknown>) {
            return { commandPayload: { undo: { before, after } } }
        }

        it('restores the previous value of an override that still exists', async () => {
            const changeStateCommand = loadCommand()
            const existingOverride: Record<string, unknown> = {
                id: overrideId,
                toggle: { id: toggleId },
                tenantId,
                value: 'disabled',
            }
            const { em, ctx } = buildContext(existingOverride)
            const before = { id: overrideId, toggleId, tenantId, value: 'enabled' }

            await changeStateCommand.undo({ logEntry: undoLogEntry(before, { ...before, value: 'disabled' }), ctx })

            expect(existingOverride.value).toBe('enabled')
            expect(em.create).not.toHaveBeenCalled()
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', tenantId)
        })

        it('recreates a cleared override with its original id and value', async () => {
            const changeStateCommand = loadCommand()
            const { em, ctx } = buildContext(null)
            const before = { id: overrideId, toggleId, tenantId, value: 'enabled' }

            await changeStateCommand.undo({ logEntry: undoLogEntry(before, { id: null, toggleId, tenantId }), ctx })

            expect(em.create).toHaveBeenCalledWith(expect.any(Function), {
                id: overrideId,
                toggle: toggleId,
                tenantId,
                value: 'enabled',
            })
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', tenantId)
        })

        it('removes an override that the command created', async () => {
            const changeStateCommand = loadCommand()
            const { em, ctx } = buildContext({ id: overrideId, toggle: { id: toggleId }, tenantId, value: 'enabled' })
            const before = { id: null, toggleId, tenantId }

            await changeStateCommand.undo({ logEntry: undoLogEntry(before, { id: overrideId, toggleId, tenantId, value: 'enabled' }), ctx })

            expect(em.nativeDelete).toHaveBeenCalledWith(expect.any(Function), { toggle: toggleId, tenantId })
            expect(em.create).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', tenantId)
        })

        it('refuses to undo when another admin changed the override afterwards', async () => {
            const changeStateCommand = loadCommand()
            // Admin A's command logged `after` at T1; admin B has since updated the
            // override again, so its live updatedAt no longer matches T1 (T2).
            const t1 = '2026-01-01T00:00:00.000Z'
            const t2 = '2026-01-01T00:05:00.000Z'
            const existingOverride: Record<string, unknown> = {
                id: overrideId,
                toggle: { id: toggleId },
                tenantId,
                value: 'disabled-by-admin-b',
                updatedAt: new Date(t2),
            }
            const { em, ctx } = buildContext(existingOverride)
            const before = { id: overrideId, toggleId, tenantId, value: 'enabled' }
            const after = { id: overrideId, toggleId, tenantId, value: 'disabled-by-admin-a', updatedAt: t1 }

            await expect(
                changeStateCommand.undo({ logEntry: undoLogEntry(before, after), ctx }),
            ).rejects.toMatchObject({ status: 409 })

            expect(existingOverride.value).toBe('disabled-by-admin-b')
            expect(em.create).not.toHaveBeenCalled()
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(em.flush).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()
        })

        it('refuses to undo a create when the override was changed since creation', async () => {
            const changeStateCommand = loadCommand()
            const t1 = '2026-01-01T00:00:00.000Z'
            const t2 = '2026-01-01T00:05:00.000Z'
            const existingOverride: Record<string, unknown> = {
                id: overrideId,
                toggle: { id: toggleId },
                tenantId,
                value: 'changed-by-admin-b',
                updatedAt: new Date(t2),
            }
            const { em, ctx } = buildContext(existingOverride)
            const before = { id: null, toggleId, tenantId }
            const after = { id: overrideId, toggleId, tenantId, value: 'enabled', updatedAt: t1 }

            await expect(
                changeStateCommand.undo({ logEntry: undoLogEntry(before, after), ctx }),
            ).rejects.toMatchObject({ status: 409 })

            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()
        })

        it('still undoes when the live override matches the logged after state', async () => {
            const changeStateCommand = loadCommand()
            const t1 = '2026-01-01T00:00:00.000Z'
            const existingOverride: Record<string, unknown> = {
                id: overrideId,
                toggle: { id: toggleId },
                tenantId,
                value: 'disabled',
                updatedAt: new Date(t1),
            }
            const { em, ctx } = buildContext(existingOverride)
            const before = { id: overrideId, toggleId, tenantId, value: 'enabled' }
            const after = { id: overrideId, toggleId, tenantId, value: 'disabled', updatedAt: t1 }

            await changeStateCommand.undo({ logEntry: undoLogEntry(before, after), ctx })

            expect(existingOverride.value).toBe('enabled')
            expect(em.flush).toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', tenantId)
        })

        it('reads the live override under a pessimistic write lock inside a transaction', async () => {
            const changeStateCommand = loadCommand()
            const existingOverride: Record<string, unknown> = {
                id: overrideId,
                toggle: { id: toggleId },
                tenantId,
                value: 'disabled',
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }
            const { em, ctx } = buildContext(existingOverride)
            const before = { id: overrideId, toggleId, tenantId, value: 'enabled' }
            const after = { id: overrideId, toggleId, tenantId, value: 'disabled', updatedAt: '2026-01-01T00:00:00.000Z' }

            await changeStateCommand.undo({ logEntry: undoLogEntry(before, after), ctx })

            expect(em.findOne).toHaveBeenCalledWith(
                expect.any(Function),
                { toggle: toggleId, tenantId },
                { lockMode: expect.anything() },
            )
            expect(em.begin).toHaveBeenCalled()
            expect(em.commit).toHaveBeenCalled()
            expect(em.rollback).not.toHaveBeenCalled()
        })
    })

    describe('changeOverrideStateCommand redo', () => {
        const toggleId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
        const tenantId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
        const overrideId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
        const originalUpdatedAt = '2026-01-01T00:00:00.000Z'
        const restoredUpdatedAt = '2026-01-01T00:05:00.000Z'
        const before = { id: null, toggleId, tenantId, updatedAt: null }
        const after = { id: overrideId, toggleId, tenantId, value: false, updatedAt: originalUpdatedAt }
        const input = { toggleId, tenantId, isOverride: true, overrideValue: 'different-input-value' }

        function loadRedoCommand() {
            jest.isolateModules(() => {
                require('../overrides')
            })
            const command = registerCommand.mock.calls.find(([registered]) => registered.id === 'feature_toggles.overrides.changeState')?.[0] as CommandHandler<ProcessedChangeOverrideStateInput, { overrideToggleId: string | null }>
            expect(command).toBeDefined()
            expect(command.redo).toBeDefined()
            return command
        }

        function buildRedoContext() {
            const state = {
                toggle: { id: toggleId, identifier: 'test_feature', deletedAt: null } as FeatureToggle | null,
                override: null as FeatureToggleOverride | null,
            }
            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn(async (entity: { name: string }, query: Record<string, unknown>) => {
                    if (entity.name === 'FeatureToggle' && query.id === toggleId) {
                        return query.deletedAt === null && state.toggle?.deletedAt ? null : state.toggle
                    }
                    if (entity.name === 'FeatureToggleOverride' && query.toggle === toggleId && query.tenantId === tenantId) {
                        return state.override?.tenantId === query.tenantId ? state.override : null
                    }
                    return null
                }),
                create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
                    state.override = { ...data, updatedAt: new Date(restoredUpdatedAt) } as unknown as FeatureToggleOverride
                    return state.override
                }),
                nativeDelete: jest.fn(async () => {
                    state.override = null
                    return 1
                }),
                flush: jest.fn().mockResolvedValue(undefined),
                begin: jest.fn().mockResolvedValue(undefined),
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                isInTransaction: jest.fn().mockReturnValue(false),
            }
            const ctx = {
                container: {
                    resolve: jest.fn((token: string) => {
                        if (token === 'em') return em
                        if (token === 'featureTogglesService') return { invalidateIsEnabledCacheByKey }
                        return undefined
                    }),
                },
            } as unknown as CommandRuntimeContext
            return { em, ctx, state }
        }

        it.each<JsonValue>([false, 0, 'snapshot-value', { nested: [false, 0, { enabled: true }] }])('restores the original override id and snapshot value %j', async (value) => {
            const command = loadRedoCommand()
            const { em, ctx, state } = buildRedoContext()
            const logEntry = { commandPayload: { value: { undo: { before, after: { ...after, value } } }, __redoInput: input } }

            const result = await command.redo!({ input, ctx, logEntry })

            expect(result).toEqual({ overrideToggleId: overrideId })
            expect(em.create).toHaveBeenCalledWith(expect.any(Function), {
                id: overrideId,
                toggle: state.toggle,
                tenantId,
                value,
            })
            expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { id: toggleId, deletedAt: null }, undefined)
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(em.flush).toHaveBeenCalledTimes(1)
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', tenantId)
            expect(em.flush.mock.invocationCallOrder[0]).toBeLessThan(invalidateIsEnabledCacheByKey.mock.invocationCallOrder[0])
        })

        it('falls back to the top-level after snapshot when the undo envelope has only before', async () => {
            const command = loadRedoCommand()
            const { ctx, em } = buildRedoContext()
            const logEntry = { commandPayload: { undo: { before } }, snapshotAfter: after }

            await expect(command.redo!({ input, ctx, logEntry })).resolves.toEqual({ overrideToggleId: overrideId })

            expect(em.create).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ id: overrideId, value: false, tenantId }))
        })

        it.each([overrideId, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'])('refuses an occupied creation redo without mutating override %s and allows retry after removal', async (occupiedId) => {
            const command = loadRedoCommand()
            const { ctx, em, state } = buildRedoContext()
            const occupyingOverride: FeatureToggleOverride = {
                id: occupiedId,
                toggle: state.toggle!,
                tenantId,
                value: { occupied: true },
                createdAt: new Date(originalUpdatedAt),
                updatedAt: new Date(restoredUpdatedAt),
            }
            state.override = occupyingOverride
            const logEntry = { commandPayload: { undo: { before, after } } }

            await expect(command.redo!({ input, ctx, logEntry })).rejects.toMatchObject({
                status: 409,
                body: { error: 'An override already exists for this feature toggle. Redo was refused.' },
            })

            expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { toggle: toggleId, tenantId }, undefined)
            expect(state.override).toBe(occupyingOverride)
            expect(occupyingOverride).toMatchObject({ id: occupiedId, value: { occupied: true }, updatedAt: new Date(restoredUpdatedAt) })
            expect(em.create).not.toHaveBeenCalled()
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(em.flush).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()

            state.override = null
            await expect(command.redo!({ input, ctx, logEntry })).resolves.toEqual({ overrideToggleId: overrideId })
            expect(state.override).toMatchObject({ id: overrideId, value: after.value, tenantId })
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledTimes(1)
        })

        it.each([
            { code: '23505', constraint: 'feature_toggle_overrides_toggle_tenant_unique' },
            { cause: { code: '23505', constraint: 'feature_toggle_overrides_toggle_tenant_unique' } },
            { previous: { code: '23505', constraint: 'feature_toggle_overrides_pkey' } },
        ])('maps a creation flush uniqueness race to 409 without invalidating cache: %j', async (databaseError) => {
            const command = loadRedoCommand()
            const { ctx, em, state } = buildRedoContext()
            const occupyingOverride: FeatureToggleOverride = {
                id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
                toggle: state.toggle!,
                tenantId,
                value: 'concurrent value',
                createdAt: new Date(originalUpdatedAt),
                updatedAt: new Date(restoredUpdatedAt),
            }
            em.flush.mockImplementationOnce(async () => {
                state.override = occupyingOverride
                throw databaseError
            })
            const logEntry = { commandPayload: { undo: { before, after } } }

            await expect(command.redo!({ input, ctx, logEntry })).rejects.toMatchObject({
                status: 409,
                body: { error: 'An override already exists for this feature toggle. Redo was refused.' },
            })

            expect(state.override).toBe(occupyingOverride)
            expect(occupyingOverride.value).toBe('concurrent value')
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()

            state.override = null
            await expect(command.redo!({ input, ctx, logEntry })).resolves.toEqual({ overrideToggleId: overrideId })
            expect(state.override).toMatchObject({ id: overrideId, value: after.value })
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledTimes(1)
        })

        it('preserves an unrelated tenant override while restoring this tenant override', async () => {
            const command = loadRedoCommand()
            const { ctx, em, state } = buildRedoContext()
            const otherTenantOverride: FeatureToggleOverride = {
                id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
                toggle: state.toggle!,
                tenantId: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
                value: 'other tenant value',
                createdAt: new Date(originalUpdatedAt),
                updatedAt: new Date(restoredUpdatedAt),
            }
            state.override = otherTenantOverride

            await expect(command.redo!({ input, ctx, logEntry: { commandPayload: { undo: { before, after } } } })).resolves.toEqual({ overrideToggleId: overrideId })

            expect(otherTenantOverride.value).toBe('other tenant value')
            expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { toggle: toggleId, tenantId }, undefined)
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', tenantId)
        })

        it('propagates an unrelated persistence error without invalidating cache', async () => {
            const command = loadRedoCommand()
            const { ctx, em } = buildRedoContext()
            const databaseError = new Error('database unavailable')
            em.flush.mockRejectedValueOnce(databaseError)

            await expect(command.redo!({ input, ctx, logEntry: { commandPayload: { undo: { before, after } } } })).rejects.toBe(databaseError)

            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()
        })

        it.each([
            ['missing', undefined],
            ['null', null],
            ['missing id', { toggleId, tenantId, value: false }],
            ['null id', { ...after, id: null }],
        ])('refuses a creation redo with a %s after snapshot', async (_name, snapshot) => {
            const command = loadRedoCommand()
            const { em, ctx } = buildRedoContext()
            const logEntry = { commandPayload: { undo: { before, after: snapshot } } }

            await expect(command.redo!({ input, ctx, logEntry })).rejects.toMatchObject({ status: 400 })

            expect(em.create).not.toHaveBeenCalled()
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(em.flush).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()
        })

        it.each([
            ['toggle', { ...after, toggleId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' }],
            ['tenant', { ...after, tenantId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' }],
        ])('refuses a creation redo when the snapshot %s differs from the input', async (_name, snapshot) => {
            const command = loadRedoCommand()
            const { em, ctx } = buildRedoContext()
            const logEntry = { commandPayload: { undo: { before, after: snapshot } } }

            await expect(command.redo!({ input, ctx, logEntry })).rejects.toMatchObject({ status: 400 })

            expect(em.create).not.toHaveBeenCalled()
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(em.flush).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()
        })

        it.each(['missing', 'deleted'])('refuses creation redo when the global toggle is %s', async (condition) => {
            const command = loadRedoCommand()
            const { em, ctx, state } = buildRedoContext()
            state.toggle = condition === 'missing' ? null : { ...state.toggle, deletedAt: new Date() } as FeatureToggle
            const logEntry = { commandPayload: { undo: { before, after } } }

            await expect(command.redo!({ input, ctx, logEntry })).rejects.toMatchObject({ status: 404 })

            expect(em.create).not.toHaveBeenCalled()
            expect(em.nativeDelete).not.toHaveBeenCalled()
            expect(em.flush).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).not.toHaveBeenCalled()
        })

        it.each([true, false])('delegates existing override replay to execute with isOverride=%s', async (isOverride) => {
            const command = loadRedoCommand()
            const { ctx, em } = buildRedoContext()
            const replayInput = { ...input, isOverride }
            const result = { overrideToggleId: isOverride ? overrideId : null }
            const execute = jest.spyOn(command, 'execute').mockResolvedValue(result)
            const logEntry = { commandPayload: { undo: { before: after, after: isOverride ? after : before } } }

            await expect(command.redo!({ input: replayInput, ctx, logEntry })).resolves.toEqual(result)

            expect(execute).toHaveBeenCalledWith(replayInput, ctx)
            expect(em.create).not.toHaveBeenCalled()
            execute.mockRestore()
        })

        it('replays clearing an already inherited override without requiring a creation snapshot', async () => {
            const command = loadRedoCommand()
            const { ctx, em } = buildRedoContext()
            const replayInput = { toggleId, tenantId, isOverride: false }
            const logEntry = { commandPayload: { undo: { before, after: before } } }

            await expect(command.redo!({ input: replayInput, ctx, logEntry })).resolves.toEqual({ overrideToggleId: null })

            expect(em.nativeDelete).toHaveBeenCalledWith(expect.any(Function), { toggle: toggleId, tenantId })
            expect(em.create).not.toHaveBeenCalled()
            expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('test_feature', tenantId)
        })

        it('logs the recreated version so a second undo removes the restored override', async () => {
            const command = loadRedoCommand()
            const { ctx, state, em } = buildRedoContext()
            const prepared = await command.prepare!(input, ctx)
            const result = await command.redo!({ input, ctx, logEntry: { commandPayload: { undo: { before, after } } } })
            const log = await command.buildLog!({ input, result, ctx, snapshots: prepared ?? {} })

            expect(log).toMatchObject({
                resourceId: overrideId,
                tenantId,
                snapshotBefore: before,
                snapshotAfter: { ...after, updatedAt: restoredUpdatedAt },
            })

            await command.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })

            expect(state.override).toBeNull()
            expect(em.nativeDelete).toHaveBeenCalledWith(expect.any(Function), { toggle: toggleId, tenantId })
            expect(em.rollback).not.toHaveBeenCalled()
        })
    })

    describe('changeOverrideStateCommand buildLog', () => {
        it('uses the after snapshot id as resourceId when the command created a new override', async () => {
            let changeStateCommand: any
            jest.isolateModules(() => {
                require('../overrides')
                changeStateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'feature_toggles.overrides.changeState')?.[0]
            })
            expect(changeStateCommand).toBeDefined()

            const toggleId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
            const tenantId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
            const createdOverrideId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
            const createdOverride: Record<string, unknown> = {
                id: createdOverrideId,
                toggle: { id: toggleId },
                tenantId,
                value: 'enabled',
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }
            const em = {
                fork: jest.fn().mockReturnThis(),
                findOne: jest.fn((entity: { name: string }, query: Record<string, unknown>) => {
                    if (entity.name === 'FeatureToggleOverride' && query.toggle === toggleId && query.tenantId === tenantId) {
                        return Promise.resolve(createdOverride)
                    }
                    return Promise.resolve(null)
                }),
            }
            const container = {
                resolve: jest.fn((token: string) => (token === 'em' ? em : undefined)),
            }
            const ctx: any = { container }
            // No prior override existed, so `prepare` captured a null-id snapshot.
            const before = { id: null, toggleId, tenantId, value: undefined, updatedAt: null }

            const log = await changeStateCommand.buildLog({ snapshots: { before }, ctx })

            expect(log.resourceId).toBe(createdOverrideId)
        })
    })
})
