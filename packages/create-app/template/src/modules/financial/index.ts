import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'financial',
  title: 'Financial Management',
  version: '0.1.0',
  description:
    'General ledger: chart of accounts, journal entries, accounting periods, and the double-entry rules that keep them sound.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
