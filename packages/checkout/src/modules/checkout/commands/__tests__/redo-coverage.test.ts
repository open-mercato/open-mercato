import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../index'

describe('checkout undoable create command redo coverage', () => {
  it('requires every logged undoable *.create command to define redo', () => {
    const missingRedo = commandRegistry
      .list()
      .sort()
      .filter((id) => id.startsWith('checkout.') && id.endsWith('.create'))
      .filter((id) => {
        const handler = commandRegistry.get(id)
        return Boolean(
          handler?.isUndoable &&
            typeof handler.buildLog === 'function' &&
            typeof handler.redo !== 'function',
        )
      })

    expect(missingRedo).toEqual([])
  })
})
