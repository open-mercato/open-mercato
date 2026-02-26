import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'translations',
  title: 'Entity Translations',
  version: '0.1.0',
  description: 'System-wide entity translation storage and locale overlay for CRUD responses.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}
