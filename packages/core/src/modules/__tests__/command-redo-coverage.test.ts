import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../auth/commands/users'
import '../auth/commands/roles'
import '../catalog/commands'
import '../currencies/commands/currencies'
import '../currencies/commands/exchange-rates'
import '../customers/commands'
import '../dictionaries/commands'
import '../directory/commands/tenants'
import '../directory/commands/organizations'
import '../feature_toggles/commands'
import '../planner/commands'
import '../resources/commands'
import '../sales/commands'
import '../staff/commands'
import '../translations/commands'

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
