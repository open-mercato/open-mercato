import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import metadata from '../index'

it('allows the Communications Hub to load without the progress module', () => {
  const info: ModuleInfo = metadata
  expect(info.requires ?? []).not.toContain('progress')
})
