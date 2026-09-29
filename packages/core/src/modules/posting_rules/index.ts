import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'posting_rules',
  title: 'Posting Rules Engine',
  version: '0.1.0',
  description:
    'Automatic zespół 4 → zespół 5 cost reclassification (account 490) for Polish dual-view accounting.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger', 'journal_entry_line_dimension'],
  ejectable: true,
}
