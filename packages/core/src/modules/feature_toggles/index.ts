import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'feature_toggles',
  title: 'Feature Toggles',
  version: '0.1.0',
  description: 'Global feature flags with tenant-level overrides.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
