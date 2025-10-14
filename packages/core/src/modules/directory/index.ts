import './commands/tenants'
import './commands/organizations'
import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'directory',
  title: 'Directory (Tenants & Organizations)',
  version: '0.1.0',
  description: 'Multi-tenant directory with tenants and organizations.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}
