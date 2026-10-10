export const features = [
  { id: 'financial.read', title: 'View the ledger', module: 'financial' },
  {
    id: 'financial.write',
    title: 'Manage accounts, journal drafts and periods',
    module: 'financial',
    dependsOn: ['financial.read'],
  },
  {
    id: 'financial.post',
    title: 'Post and reverse journal entries',
    module: 'financial',
    dependsOn: ['financial.write'],
  },
  {
    id: 'financial.close',
    title: 'Close and reopen accounting periods',
    module: 'financial',
    dependsOn: ['financial.post'],
  },
  {
    id: 'financial.admin',
    title: 'Administer financial settings',
    module: 'financial',
    dependsOn: ['financial.close'],
  },
  {
    id: 'financial.payments.view',
    title: 'View payment methods, cash accounts and payments',
    module: 'financial',
    dependsOn: ['financial.read'],
  },
  {
    id: 'financial.payments.manage',
    title: 'Manage payment methods, cash accounts and record payments',
    module: 'financial',
    dependsOn: ['financial.payments.view'],
  },
]

export default features
