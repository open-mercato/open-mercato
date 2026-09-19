import type { SearchBuildContext } from '@open-mercato/shared/modules/search'
import { searchConfig } from '../search'

describe('WMS Site search navigation', () => {
  it('opens the matching Site detail route', async () => {
    const site = searchConfig.entities.find((entry) => entry.entityId.includes('site'))
    const context: SearchBuildContext = {
      record: { id: '33333333-3333-4333-8333-333333333333' },
      customFields: {},
    }

    await expect(site?.resolveUrl?.(context)).resolves.toBe(
      '/backend/wms/sites/33333333-3333-4333-8333-333333333333',
    )
  })
})
