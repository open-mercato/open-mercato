import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'sales_invoices_gl_posting',
  title: 'Sales Invoice GL Posting',
  version: '0.1.0',
  description: 'Posts finalized sales invoices to the General Ledger as balanced journal entries.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger', 'sales', 'currencies'],
  ejectable: true,
}
