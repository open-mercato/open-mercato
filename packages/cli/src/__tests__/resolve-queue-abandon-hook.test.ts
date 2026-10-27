import { resolveQueueAbandonHook } from '../mercato'

/**
 * Covers the CLI's per-queue pick, which is the last link between worker metadata and the queue the
 * worker runs on. The warning exists because two handlers on one queue each expecting to report is a
 * wiring mistake, and a silent first-wins would hide it.
 */
describe('resolveQueueAbandonHook', () => {
  const hookA = jest.fn(async () => {})
  const hookB = jest.fn(async () => {})

  it('returns undefined when no worker declares one', () => {
    const warn = jest.fn()
    expect(resolveQueueAbandonHook('q', [{ id: 'a' }, { id: 'b' }], warn)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('returns the single declared callback without warning', () => {
    const warn = jest.fn()
    expect(resolveQueueAbandonHook('q', [{ id: 'a' }, { id: 'b', onJobAbandoned: hookA }], warn)).toBe(hookA)
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the first and warns, naming the queue and every declaring worker', () => {
    const warn = jest.fn()
    const picked = resolveQueueAbandonHook(
      'data-sync-import',
      [{ id: 'first', onJobAbandoned: hookA }, { id: 'second', onJobAbandoned: hookB }],
      warn,
    )

    expect(picked).toBe(hookA)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain('data-sync-import')
    expect(message).toContain('first')
    expect(message).toContain('second')
  })
})
