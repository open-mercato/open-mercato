import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'journal_entry_line_dimensions',
  title: 'Journal Entry Line Dimensions',
  version: '0.1.0',
  description:
    'Analytical dimension tags (cost centre in Phase 1) on a journal entry line, with per-writer ownership and a frozen-period guard.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger'],
  ejectable: true,
}
