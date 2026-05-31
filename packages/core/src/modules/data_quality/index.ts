import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'data_quality',
  title: 'Data Quality',
  version: '0.1.0',
  description: 'Cross-module data quality checks, scans, findings, and scorecards.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
  requires: ['business_rules', 'progress', 'query_index'],
}

export { features } from './acl'
