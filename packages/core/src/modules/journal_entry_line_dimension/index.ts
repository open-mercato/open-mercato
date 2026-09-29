import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'journal_entry_line_dimension',
  title: 'Journal Entry Line Dimension',
  version: '0.1.0',
  description:
    'Multi-dimensional analytical tags (cost centre, bank account, fixed asset, currency) on a journal entry line.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger'],
  ejectable: true,
}
