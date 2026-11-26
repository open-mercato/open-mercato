/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: (entity: unknown, filters: Record<string, unknown>) => Promise<unknown> }, entity: unknown, filters: Record<string, unknown>) => em.findOne(entity, filters)),
}))

import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CustomerComment, CustomerDeal, CustomerEntity } from '../../data/entities'
import '../comments'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const commentId = '33333333-3333-4333-8333-333333333333'
const entityId = '44444444-4444-4444-8444-444444444444'
const sourceDealId = '55555555-5555-4555-8555-555555555555'

type Harness = {
  ctx: CommandRuntimeContext
  steps: string[]
  comment: CustomerComment | null
  persisted: CustomerComment[]
  dealLive: { value: boolean }
}

function harness(options: { commentExists?: boolean; dealLive?: boolean } = {}): Harness {
  const steps: string[] = []
  const dealLive = { value: options.dealLive ?? true }
  const entity = { id: entityId, kind: 'person', tenantId, organizationId }
  const deal = { id: sourceDealId, tenantId, organizationId }
  const persisted: CustomerComment[] = []
  const state: Harness = {
    ctx: {} as CommandRuntimeContext,
    steps,
    comment: options.commentExists === false
      ? null
      : ({ id: commentId, tenantId, organizationId, entity, deal: null, body: 'Original', authorUserId: null } as unknown as CustomerComment),
    persisted,
    dealLive,
  }
  const em = {
    findOne: jest.fn(async (type: unknown) => {
      if (type === CustomerComment) {
        steps.push('read:comment')
        return state.comment
      }
      if (type === CustomerEntity) return entity
      if (type === CustomerDeal) {
        steps.push('read:deal')
        return dealLive.value ? deal : null
      }
      return null
    }),
    execute: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) steps.push(`lock:${String(params[0]).split(':').pop()}`)
      return []
    }),
    create: jest.fn((_type: unknown, data: Record<string, unknown>) => ({ id: commentId, ...data })),
    persist: jest.fn((row: CustomerComment) => {
      steps.push('persist')
      persisted.push(row)
    }),
    remove: jest.fn(),
    flush: jest.fn(async () => { steps.push('flush') }),
    begin: jest.fn(async () => { steps.push('begin') }),
    commit: jest.fn(async () => { steps.push('commit') }),
    rollback: jest.fn(async () => { steps.push('rollback') }),
    fork: () => em,
  }
  state.ctx = {
    auth: { sub: 'user-1', tenantId, orgId: organizationId },
    selectedOrganizationId: organizationId,
    container: { resolve: (key: string) => (key === 'em' ? em : {}) },
  } as unknown as CommandRuntimeContext
  return state
}

function handler(id: string): CommandHandler {
  return commandRegistry.get(id) as CommandHandler
}

function snapshot(dealId: string | null) {
  return {
    id: commentId,
    tenantId,
    organizationId,
    entityId,
    entityKind: 'person',
    dealId,
    body: 'Restored',
    authorUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
  }
}

function expectLockedWrite(steps: string[]) {
  const begin = steps.indexOf('begin')
  const lock = steps.indexOf(`lock:${sourceDealId}`)
  const readDeal = steps.indexOf('read:deal')
  const commit = steps.indexOf('commit')
  expect(begin).toBeGreaterThanOrEqual(0)
  expect(lock).toBeGreaterThan(begin)
  expect(readDeal).toBeGreaterThan(lock)
  expect(steps.lastIndexOf('flush')).toBeGreaterThan(readDeal)
  expect(commit).toBeGreaterThan(steps.lastIndexOf('flush'))
}

beforeEach(() => jest.clearAllMocks())

describe('comment writes take the Deal reference lock (deal merge protocol)', () => {
  it('create locks the Deal, re-checks it and inserts in one transaction', async () => {
    const state = harness({ commentExists: false })
    await handler('customers.comments.create').execute({
      tenantId,
      organizationId,
      entityId,
      dealId: sourceDealId,
      body: 'Note',
    }, state.ctx)
    expectLockedWrite(state.steps)
    expect(state.steps.indexOf('persist')).toBeGreaterThan(state.steps.indexOf('read:deal'))
  })

  it('create is refused and rolled back once the Deal is gone', async () => {
    const state = harness({ commentExists: false, dealLive: false })
    await expect(handler('customers.comments.create').execute({
      tenantId,
      organizationId,
      entityId,
      dealId: sourceDealId,
      body: 'Note',
    }, state.ctx)).rejects.toMatchObject({ status: 400 })
    expect(state.steps).toContain(`lock:${sourceDealId}`)
    expect(state.steps).toContain('rollback')
    expect(state.steps).not.toContain('commit')
    expect(state.persisted).toHaveLength(0)
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('create without a Deal takes no lock', async () => {
    const state = harness({ commentExists: false })
    await handler('customers.comments.create').execute({ tenantId, organizationId, entityId, body: 'Note' }, state.ctx)
    expect(state.steps.some((step) => step.startsWith('lock:'))).toBe(false)
  })

  it('relink locks the target Deal and reads the comment inside the same transaction', async () => {
    const state = harness()
    await handler('customers.comments.update').execute({ id: commentId, dealId: sourceDealId }, state.ctx)
    expectLockedWrite(state.steps)
    expect(state.steps.indexOf('read:comment')).toBeGreaterThan(state.steps.indexOf('begin'))
    expect((state.comment as unknown as { deal: { id: string } }).deal.id).toBe(sourceDealId)
  })

  it('relink to a merged-away Deal is refused without touching the comment', async () => {
    const state = harness({ dealLive: false })
    await expect(handler('customers.comments.update').execute({ id: commentId, dealId: sourceDealId, body: 'Edited' }, state.ctx))
      .rejects.toMatchObject({ status: 400 })
    expect(state.comment).toMatchObject({ body: 'Original', deal: null })
    expect(state.steps).toContain('rollback')
    expect(state.steps).not.toContain('flush')
  })

  it('a body-only edit takes no Deal lock', async () => {
    const state = harness()
    await handler('customers.comments.update').execute({ id: commentId, body: 'Edited' }, state.ctx)
    expect(state.steps.some((step) => step.startsWith('lock:'))).toBe(false)
    expect(state.steps).toEqual(expect.arrayContaining(['begin', 'flush', 'commit']))
  })

  it('undo of delete restores under the Deal lock', async () => {
    const state = harness({ commentExists: false })
    await handler('customers.comments.delete').undo!({
      input: {},
      ctx: state.ctx,
      logEntry: { commandPayload: { undo: { before: snapshot(sourceDealId) } } } as never,
    })
    expectLockedWrite(state.steps)
    expect(state.persisted).toHaveLength(1)
  })

  it('undo of update restores under the Deal lock and refuses a gone Deal', async () => {
    const live = harness()
    await handler('customers.comments.update').undo!({
      input: {},
      ctx: live.ctx,
      logEntry: { commandPayload: { undo: { before: snapshot(sourceDealId) } } } as never,
    })
    expectLockedWrite(live.steps)

    const gone = harness({ dealLive: false })
    await expect(handler('customers.comments.update').undo!({
      input: {},
      ctx: gone.ctx,
      logEntry: { commandPayload: { undo: { before: snapshot(sourceDealId) } } } as never,
    })).rejects.toMatchObject({ status: 400 })
    expect(gone.comment).toMatchObject({ body: 'Original', deal: null })
    expect(gone.steps).toContain('rollback')
  })

  it('redo of create restores under the Deal lock and refuses a gone Deal', async () => {
    const live = harness({ commentExists: false })
    await handler('customers.comments.create').redo!({
      input: {},
      ctx: live.ctx,
      logEntry: { resourceId: commentId, commandPayload: { undo: { after: snapshot(sourceDealId) } } } as never,
    })
    expectLockedWrite(live.steps)
    expect(live.persisted).toHaveLength(1)

    const gone = harness({ commentExists: false, dealLive: false })
    await expect(handler('customers.comments.create').redo!({
      input: {},
      ctx: gone.ctx,
      logEntry: { resourceId: commentId, commandPayload: { undo: { after: snapshot(sourceDealId) } } } as never,
    })).rejects.toMatchObject({ status: 400 })
    expect(gone.persisted).toHaveLength(0)
    expect(gone.steps).toContain('rollback')
  })
})
