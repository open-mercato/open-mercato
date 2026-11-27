import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import {
  describeDisabledSourceModule,
  isScheduleSourceModuleDisabled,
} from '../sourceModuleAvailability'

function resetRegistry() {
  ;(globalThis as Record<string, unknown>).__openMercatoModulesRegistry__ = null
}

describe('isScheduleSourceModuleDisabled (#8381)', () => {
  afterEach(resetRegistry)

  describe('with an enabled module set', () => {
    beforeEach(() => {
      registerModules([{ id: 'scheduler' }, { id: 'data_sync' }] as never)
    })

    it('flags a module-authored row whose source module is not enabled', () => {
      expect(isScheduleSourceModuleDisabled({ sourceType: 'module', sourceModule: 'push_notifications' })).toBe(true)
    })

    it('keeps a module-authored row whose source module is enabled', () => {
      expect(isScheduleSourceModuleDisabled({ sourceType: 'module', sourceModule: 'data_sync' })).toBe(false)
    })

    it('ignores user-authored rows whatever their source module says', () => {
      expect(isScheduleSourceModuleDisabled({ sourceType: 'user', sourceModule: 'push_notifications' })).toBe(false)
    })

    it('does not judge a module row without a recorded source module', () => {
      expect(isScheduleSourceModuleDisabled({ sourceType: 'module', sourceModule: null })).toBe(false)
      expect(isScheduleSourceModuleDisabled({ sourceType: 'module', sourceModule: '  ' })).toBe(false)
    })
  })

  it('treats every row as enabled when the module registry is not bootstrapped', () => {
    resetRegistry()
    expect(isScheduleSourceModuleDisabled({ sourceType: 'module', sourceModule: 'push_notifications' })).toBe(false)
  })

  it('describes the skip with the module id', () => {
    expect(describeDisabledSourceModule({ sourceModule: 'checkout' })).toBe('Source module is not enabled: checkout')
  })
})
