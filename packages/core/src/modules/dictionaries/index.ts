import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'dictionaries',
  title: 'Shared Dictionaries',
  version: '0.1.0',
  description: 'Organization-scoped dictionaries for reusable enumerations and appearance presets.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
