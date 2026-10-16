import { MetadataStorage } from '@mikro-orm/core'
import { WorkflowInstance } from '../entities'

// The signal claim pins the `updatedAt` it read to identify one occurrence of a
// wait (#7185). A re-park landing in the same millisecond as the claim must still
// move the column forward, or a delayed duplicate would match the new wait.
describe('WorkflowInstance.updatedAt — strictly increasing on update (#7185)', () => {
  function resolveOnUpdate(): (instance: Pick<WorkflowInstance, 'updatedAt'>) => Date {
    const path = (WorkflowInstance as unknown as Record<symbol, string>)[MetadataStorage.PATH_SYMBOL]
    const meta = MetadataStorage.getMetadata(WorkflowInstance.name, path)
    const onUpdate = meta?.properties?.updatedAt?.onUpdate
    if (typeof onUpdate !== 'function') throw new Error('[internal] updatedAt has no onUpdate hook')
    return onUpdate as unknown as (instance: Pick<WorkflowInstance, 'updatedAt'>) => Date
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('moves past the previous value when the clock has not advanced', () => {
    const previous = new Date('2026-10-11T08:00:00.000Z')
    jest.spyOn(Date, 'now').mockReturnValue(previous.getTime())

    expect(resolveOnUpdate()({ updatedAt: previous }).getTime()).toBe(previous.getTime() + 1)
  })

  it('uses the current time when it is already later than the previous value', () => {
    const previous = new Date('2026-10-11T08:00:00.000Z')
    jest.spyOn(Date, 'now').mockReturnValue(previous.getTime() + 5_000)

    expect(resolveOnUpdate()({ updatedAt: previous }).getTime()).toBe(previous.getTime() + 5_000)
  })
})
