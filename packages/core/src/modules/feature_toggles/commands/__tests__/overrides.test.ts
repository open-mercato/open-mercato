
export { }

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
