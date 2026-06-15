import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../auth'
import '../catalog'
import '../currencies'
import '../customers'
import '../dictionaries'
import '../directory'
import '../feature_toggles'
import '../planner'
import '../resources'
import '../sales'
import '../staff'
import '../translations'

describe('undoable create command redo coverage', () => {
  it('requires every logged undoable *.create command to define redo', () => {
    const missingRedo = commandRegistry
      .list()
      .sort()
      .filter((id) => id.endsWith('.create'))
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
