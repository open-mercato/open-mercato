import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'seeds',
  title: 'Seeds',
  version: '0.1.0',
  description:
    'Encrypted data seeding: encrypt confidential seed files for the repo and load them into a tenant on setup.',
  author: 'Open Mercato Team',
  license: 'MIT',
}
