import {
  matchesCommandPattern,
  runCommandInterceptorsBefore,
  runCommandInterceptorsAfter,
  runCommandInterceptorsBeforeUndo,
  runCommandInterceptorsAfterUndo,
} from '../command-interceptor-runner'
import type { CommandInterceptor, CommandInterceptorContext, CommandInterceptorUndoContext } from '../command-interceptor'

const baseContext: CommandInterceptorContext = {
  commandId: 'customers.create-person',
  auth: null,
  organizationScope: null,
  selectedOrganizationId: 'org-1',
  container: {} as any,
}

function makeInterceptor(overrides: Partial<CommandInterceptor> & { id: string }): CommandInterceptor {
  return {
    targetCommand: 'customers.*',
    priority: 50,
    ...overrides,
  }
}

describe('matchesCommandPattern', () => {
  it('matches global wildcard', () => {
    expect(matchesCommandPattern('*', 'customers.create-person')).toBe(true)
  })

  it('matches exact command', () => {
    expect(matchesCommandPattern('customers.create-person', 'customers.create-person')).toBe(true)
    expect(matchesCommandPattern('customers.create-person', 'customers.update-person')).toBe(false)
  })

  it('matches module wildcard', () => {
    expect(matchesCommandPattern('customers.*', 'customers.create-person')).toBe(true)
    expect(matchesCommandPattern('customers.*', 'customers.update-person')).toBe(true)
    expect(matchesCommandPattern('customers.*', 'sales.create-order')).toBe(false)
  })

  it('does not match partial prefix without wildcard', () => {
    expect(matchesCommandPattern('customers', 'customers.create-person')).toBe(false)
  })
})

describe('runCommandInterceptorsBefore', () => {
  it('returns ok when no interceptors match', async () => {
    const interceptor = makeInterceptor({
      id: 'i1',
      targetCommand: 'sales.*',
      beforeExecute: jest.fn(),
    })
    const result = await runCommandInterceptorsBefore([interceptor], 'customers.create-person', {}, baseContext, [])
    expect(result.ok).toBe(true)
    expect(interceptor.beforeExecute).not.toHaveBeenCalled()
  })

  it('runs matching interceptors in priority order', async () => {
    const callOrder: string[] = []
    const i1 = makeInterceptor({
      id: 'i1',
      priority: 20,
      beforeExecute: jest.fn(async () => { callOrder.push('i1'); return { ok: true } }),
    })
    const i2 = makeInterceptor({
      id: 'i2',
      priority: 10,
      beforeExecute: jest.fn(async () => { callOrder.push('i2'); return { ok: true } }),
    })
    const result = await runCommandInterceptorsBefore([i1, i2], 'customers.create-person', {}, baseContext, [])
    expect(result.ok).toBe(true)
    expect(callOrder).toEqual(['i2', 'i1'])
  })

  it('stops on first rejection', async () => {
    const i1 = makeInterceptor({
      id: 'i1',
      priority: 10,
      beforeExecute: jest.fn().mockResolvedValue({ ok: false, message: 'Blocked' }),
    })
    const i2 = makeInterceptor({
      id: 'i2',
      priority: 20,
      beforeExecute: jest.fn(),
    })
    const result = await runCommandInterceptorsBefore([i1, i2], 'customers.create-person', {}, baseContext, [])
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('Blocked')
    expect(i2.beforeExecute).not.toHaveBeenCalled()
  })

  it('accumulates modified input', async () => {
    const i1 = makeInterceptor({
      id: 'i1',
      priority: 10,
      beforeExecute: jest.fn().mockResolvedValue({ ok: true, modifiedInput: { extra: 'from-i1' } }),
    })
    const i2 = makeInterceptor({
      id: 'i2',
      priority: 20,
      beforeExecute: jest.fn(async (input) => {
        expect((input as any).extra).toBe('from-i1')
        return { ok: true }
      }),
    })
    const result = await runCommandInterceptorsBefore([i1, i2], 'customers.create-person', { name: 'Test' }, baseContext, [])
    expect(result.ok).toBe(true)
    expect(result.modifiedInput).toEqual({ name: 'Test', extra: 'from-i1' })
  })

  it('collects metadata by interceptor ID', async () => {
    const interceptor = makeInterceptor({
      id: 'i1',
      beforeExecute: jest.fn().mockResolvedValue({ ok: true, metadata: { startTime: 123 } }),
    })
    const result = await runCommandInterceptorsBefore([interceptor], 'customers.create-person', {}, baseContext, [])
    expect(result.metadataByInterceptor.get('i1')).toEqual({ startTime: 123 })
  })

  it('filters by ACL features', async () => {
    const interceptor = makeInterceptor({
      id: 'i1',
      features: ['premium.audit'],
      beforeExecute: jest.fn().mockResolvedValue({ ok: false }),
    })

    const withoutFeature = await runCommandInterceptorsBefore([interceptor], 'customers.create-person', {}, baseContext, [])
    expect(withoutFeature.ok).toBe(true)

    const withFeature = await runCommandInterceptorsBefore([interceptor], 'customers.create-person', {}, baseContext, ['premium.audit'])
    expect(withFeature.ok).toBe(false)
  })
})

describe('runCommandInterceptorsAfter', () => {
  it('runs afterExecute with metadata from before phase', async () => {
    const afterFn = jest.fn().mockResolvedValue(undefined)
    const interceptor = makeInterceptor({ id: 'i1', afterExecute: afterFn })
    const metadata = new Map([['i1', { startTime: 123 }]])
    await runCommandInterceptorsAfter([interceptor], 'customers.create-person', {}, { id: '1' }, baseContext, [], metadata)
    expect(afterFn).toHaveBeenCalled()
    const contextArg = afterFn.mock.calls[0][2]
    expect(contextArg.metadata).toEqual({ startTime: 123 })
  })

  it('swallows errors from afterExecute', async () => {
    const interceptor = makeInterceptor({
      id: 'i1',
      afterExecute: jest.fn().mockRejectedValue(new Error('boom')),
    })
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    const metadata = new Map<string, Record<string, unknown>>()
    await runCommandInterceptorsAfter([interceptor], 'customers.create-person', {}, {}, baseContext, [], metadata)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('runCommandInterceptorsBeforeUndo', () => {
  const undoContext: CommandInterceptorUndoContext = {
    input: { name: 'Test' },
    logEntry: { id: 'log-1' },
    undoToken: 'token-1',
  }

  it('returns ok when no interceptor blocks', async () => {
    const interceptor = makeInterceptor({
      id: 'i1',
      beforeUndo: jest.fn().mockResolvedValue({ ok: true }),
    })
    const result = await runCommandInterceptorsBeforeUndo([interceptor], 'customers.create-person', undoContext, baseContext, [])
    expect(result.ok).toBe(true)
  })

  it('stops on rejection', async () => {
    const interceptor = makeInterceptor({
      id: 'i1',
      beforeUndo: jest.fn().mockResolvedValue({ ok: false, message: 'Cannot undo' }),
    })
    const result = await runCommandInterceptorsBeforeUndo([interceptor], 'customers.create-person', undoContext, baseContext, [])
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('Cannot undo')
  })
})

describe('runCommandInterceptorsAfterUndo', () => {
  const undoContext: CommandInterceptorUndoContext = {
    input: { name: 'Test' },
    logEntry: { id: 'log-1' },
    undoToken: 'token-1',
  }

  it('swallows errors from afterUndo', async () => {
    const interceptor = makeInterceptor({
      id: 'i1',
      afterUndo: jest.fn().mockRejectedValue(new Error('boom')),
    })
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    const metadata = new Map<string, Record<string, unknown>>()
    await runCommandInterceptorsAfterUndo([interceptor], 'customers.create-person', undoContext, baseContext, [], metadata)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
