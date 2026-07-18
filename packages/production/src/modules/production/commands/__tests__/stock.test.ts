export {}

// Mocked container harness for production stock commands, modeled on
// commands/__tests__/technology.test.ts. Unlike technology commands, stock
// commands do not touch `em` directly — they resolve `productionStockProvider`
// from the container and delegate every mutation to it, so only that
// provider needs to be mocked here (no in-memory em/store).

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      if (!fallback) return _key
      if (!vars) return fallback
      return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), fallback)
    },
  }),
}))

import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

function makeProvider(overrides: Record<string, jest.Mock> = {}) {
  return {
    getOnHand: jest.fn(),
    reserve: jest.fn(),
    releaseReservations: jest.fn(),
    issue: jest.fn(),
    receive: jest.fn().mockResolvedValue({ movementIds: ['mv-1'] }),
    adjust: jest.fn().mockResolvedValue({ movementId: 'mv-2' }),
    findBatches: jest.fn(),
    reverseMovement: jest.fn().mockResolvedValue({ movementId: 'mv-3' }),
    ...overrides,
  }
}

function makeCtx(provider: ReturnType<typeof makeProvider>, overrides: Record<string, unknown> = {}) {
  const resolve = jest.fn((key: string) => {
    if (key === 'productionStockProvider') return provider
    return undefined
  })
  return {
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isSuperAdmin: false },
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: ['org-1'],
    container: { resolve },
    ...overrides,
  } as any
}

/**
 * `jest.isolateModules` gives '../stock' its own isolated copy of every
 * module it transitively requires — including '../../lib/stockProvider'. A
 * top-level `import { StockUomMismatchError } from '../../lib/stockProvider'`
 * would be a DIFFERENT class than the one `commands/stock.ts` catches with
 * `instanceof` inside that isolated registry, so an `instanceof`-based test
 * assertion would silently fail even though the mapping works in production.
 * Require both '../stock' AND '../../lib/stockProvider' inside the SAME
 * `isolateModules` callback so they share one module registry, and return the
 * error classes from that call alongside the registered commands.
 */
function loadCommands(): {
  commands: Record<string, any>
  errors: typeof import('../../lib/stockProvider')
} {
  const commands: Record<string, any> = {}
  let errors: typeof import('../../lib/stockProvider') | undefined
  jest.isolateModules(() => {
    require('../stock')
    errors = require('../../lib/stockProvider')
    for (const [cmd] of registerCommand.mock.calls) {
      commands[cmd.id] = cmd
    }
  })
  return { commands, errors: errors! }
}

describe('production stock commands', () => {
  it('registers all three commands as non-undoable (decision h: storno is the compensating-movement "undo", not a classic undo)', () => {
    const { commands: cmds, errors } = loadCommands()
    expect(Object.keys(cmds).sort()).toEqual([
      'production.stock.adjust',
      'production.stock.receive',
      'production.stock.reverseMovement',
    ])
    expect(cmds['production.stock.receive'].isUndoable).toBe(false)
    expect(cmds['production.stock.receive'].undo).toBeUndefined()
    expect(cmds['production.stock.adjust'].isUndoable).toBe(false)
    expect(cmds['production.stock.adjust'].undo).toBeUndefined()
    expect(cmds['production.stock.reverseMovement'].isUndoable).toBe(false)
    expect(cmds['production.stock.reverseMovement'].undo).toBeUndefined()
  })

  describe('production.stock.receive', () => {
    it('delegates to the DI productionStockProvider with tenant/org scope, sourceType manual', async () => {
      const provider = makeProvider()
      const ctx = makeCtx(provider)
      const { commands: cmds, errors } = loadCommands()

      const result = await cmds['production.stock.receive'].execute(
        { productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs', batchNumber: 'B-1', expiresAt: null, reasonEntryId: null },
        ctx,
      )

      expect(result).toEqual({ movementIds: ['mv-1'] })
      expect(provider.receive).toHaveBeenCalledWith(
        [{ productId: 'prod-1', variantId: null, batchNumber: 'B-1', expiresAt: null, qty: 10, uom: 'pcs' }],
        { scope: { tenantId: 'tenant-1', organizationId: 'org-1' }, sourceType: 'manual', reasonEntryId: null },
      )
    })

    it('buildLog records the movement id + tenant/org scope for the audit trail', async () => {
      const provider = makeProvider()
      const ctx = makeCtx(provider)
      const { commands: cmds, errors } = loadCommands()
      const input = { productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs' }
      const result = { movementIds: ['mv-1'] }

      const log = await cmds['production.stock.receive'].buildLog({ input, result, ctx, snapshots: {} })

      expect(log.resourceKind).toBe('production.stock_movement')
      expect(log.resourceId).toBe('mv-1')
      expect(log.tenantId).toBe('tenant-1')
      expect(log.organizationId).toBe('org-1')
    })

    it('maps StockUomMismatchError to a 422 CrudHttpError with a translated message, not the raw [internal] message', async () => {
      const { commands: cmds, errors } = loadCommands()
      const provider = makeProvider({ receive: jest.fn().mockRejectedValue(new errors.StockUomMismatchError('kg', 'pcs')) })
      const ctx = makeCtx(provider)

      let caught: unknown
      try {
        await cmds['production.stock.receive'].execute({ productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs' }, ctx)
      } catch (err) {
        caught = err
      }
      expect(isCrudHttpError(caught)).toBe(true)
      expect((caught as any).status).toBe(422)
      expect((caught as any).body.error).toBe('Unit of measure mismatch: expected kg, got pcs.')
      expect((caught as any).body.error).not.toContain('[internal]')
    })
  })

  describe('production.stock.adjust', () => {
    it('delegates to provider.adjust with signed qty, NOT passing the free-text reason as reasonEntryId', async () => {
      const provider = makeProvider()
      const ctx = makeCtx(provider)
      const { commands: cmds, errors } = loadCommands()

      const result = await cmds['production.stock.adjust'].execute(
        { productId: 'prod-1', variantId: null, qty: -3, uom: 'pcs', batchNumber: null, reason: 'Opening balance correction' },
        ctx,
      )

      expect(result).toEqual({ movementId: 'mv-2' })
      expect(provider.adjust).toHaveBeenCalledWith(
        { productId: 'prod-1', variantId: null, batchNumber: null, qty: -3, uom: 'pcs' },
        null,
        { scope: { tenantId: 'tenant-1', organizationId: 'org-1' }, sourceType: 'manual', reasonEntryId: null },
      )
    })

    it('buildLog carries the free-text reason in the audit context, not the movement payload column', async () => {
      const provider = makeProvider()
      const ctx = makeCtx(provider)
      const { commands: cmds, errors } = loadCommands()
      const input = { productId: 'prod-1', variantId: null, qty: -3, uom: 'pcs', reason: 'Cycle count correction' }
      const result = { movementId: 'mv-2' }

      const log = await cmds['production.stock.adjust'].buildLog({ input, result, ctx, snapshots: {} })

      expect(log.context).toEqual({ reason: 'Cycle count correction' })
      expect(log.resourceId).toBe('mv-2')
    })

    it('maps InsufficientStockError to a 422 CrudHttpError with a translated message, not the raw [internal] message', async () => {
      const { commands: cmds, errors } = loadCommands()
      // Deliberately includes a movement-line detail in the raw message to
      // prove that detail never reaches the CrudHttpError body.
      const provider = makeProvider({
        adjust: jest.fn().mockRejectedValue(new errors.InsufficientStockError('Stock item 11111111-1111-4111-8111-111111111111 on-hand would go negative')),
      })
      const ctx = makeCtx(provider)

      let caught: unknown
      try {
        await cmds['production.stock.adjust'].execute(
          { productId: 'prod-1', variantId: null, qty: -100, uom: 'pcs', reason: 'test' },
          ctx,
        )
      } catch (err) {
        caught = err
      }
      expect(isCrudHttpError(caught)).toBe(true)
      expect((caught as any).status).toBe(422)
      expect((caught as any).body.error).toBe('Insufficient stock for this operation.')
      expect((caught as any).body.error).not.toContain('[internal]')
      expect((caught as any).body.error).not.toContain('11111111-1111-4111-8111-111111111111')
    })
  })

  describe('production.stock.reverseMovement', () => {
    it('delegates to the provider (resolved via the same DI token) reverseMovement(movementId, scope)', async () => {
      const provider = makeProvider()
      const ctx = makeCtx(provider)
      const { commands: cmds, errors } = loadCommands()

      const result = await cmds['production.stock.reverseMovement'].execute({ movementId: 'mv-1' }, ctx)

      expect(result).toEqual({ movementId: 'mv-3' })
      expect(provider.reverseMovement).toHaveBeenCalledWith('mv-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    })

    it('maps DoubleReversalError to a 409 CrudHttpError with a translated message, not the raw [internal] message (which embeds the movement UUID)', async () => {
      const { commands: cmds, errors } = loadCommands()
      const movementId = '22222222-2222-4222-8222-222222222222'
      const provider = makeProvider({ reverseMovement: jest.fn().mockRejectedValue(new errors.DoubleReversalError(movementId)) })
      const ctx = makeCtx(provider)

      let caught: unknown
      try {
        await cmds['production.stock.reverseMovement'].execute({ movementId }, ctx)
      } catch (err) {
        caught = err
      }
      expect(isCrudHttpError(caught)).toBe(true)
      expect((caught as any).status).toBe(409)
      expect((caught as any).body.error).toBe('This stock movement has already been reversed.')
      expect((caught as any).body.error).not.toContain('[internal]')
      expect((caught as any).body.error).not.toContain(movementId)
    })

    it('buildLog links back to the original movement via relatedResourceId', async () => {
      const provider = makeProvider()
      const ctx = makeCtx(provider)
      const { commands: cmds, errors } = loadCommands()
      const input = { movementId: 'mv-1' }
      const result = { movementId: 'mv-3' }

      const log = await cmds['production.stock.reverseMovement'].buildLog({ input, result, ctx, snapshots: {} })

      expect(log.resourceId).toBe('mv-3')
      expect(log.relatedResourceId).toBe('mv-1')
    })
  })

  describe('mapStockProviderError (regression, task 2.2 review follow-up)', () => {
    it('never produces a CrudHttpError body containing the literal substring "[internal]", for any of the 3 mapped domain errors', async () => {
      const { commands: cmds, errors } = loadCommands()
      const cases: Array<{ commandId: string; input: unknown; err: Error }> = [
        {
          commandId: 'production.stock.receive',
          input: { productId: 'prod-1', variantId: null, qty: 10, uom: 'pcs' },
          err: new errors.StockUomMismatchError('kg', 'pcs'),
        },
        {
          commandId: 'production.stock.adjust',
          input: { productId: 'prod-1', variantId: null, qty: -5, uom: 'pcs', reason: 'test' },
          err: new errors.InsufficientStockError('would go negative'),
        },
        {
          commandId: 'production.stock.reverseMovement',
          input: { movementId: 'mv-1' },
          err: new errors.DoubleReversalError('mv-1'),
        },
      ]

      for (const { commandId, input, err } of cases) {
        const provider = makeProvider({
          receive: jest.fn().mockRejectedValue(err),
          adjust: jest.fn().mockRejectedValue(err),
          reverseMovement: jest.fn().mockRejectedValue(err),
        })
        const ctx = makeCtx(provider)

        let caught: unknown
        try {
          await cmds[commandId].execute(input, ctx)
        } catch (thrown) {
          caught = thrown
        }
        expect(isCrudHttpError(caught)).toBe(true)
        const body = JSON.stringify((caught as any).body)
        expect(body).not.toContain('[internal]')
      }
    })
  })
})
