import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'test_package',
  title: 'Test Package',
  description: 'Minimal test package with a single backend page for workspace package scaffolding.',
}

export { features } from './acl'

export default metadata
