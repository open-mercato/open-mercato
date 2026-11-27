import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'maintenance',
  title: 'Maintenance Mode',
  version: '0.1.0',
  description: 'Instance-wide maintenance windows: API and page 503 gates, worker drain, and exclusive holds for key rotation and backups.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}
