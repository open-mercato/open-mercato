export const features = [
  { id: 'ledger.accounts.view', title: 'View chart of accounts', module: 'ledger' },
  {
    id: 'ledger.accounts.manage',
    title: 'Manage chart of accounts',
    module: 'ledger',
    dependsOn: ['ledger.accounts.view'],
  },
  { id: 'ledger.entries.view', title: 'View journal entries', module: 'ledger' },
  {
    id: 'ledger.entries.post',
    title: 'Post and reverse journal entries',
    module: 'ledger',
    dependsOn: ['ledger.entries.view'],
  },
  { id: 'ledger.periods.view', title: 'View fiscal periods', module: 'ledger' },
  {
    id: 'ledger.periods.manage',
    title: 'Create, lock and unlock fiscal periods',
    module: 'ledger',
    dependsOn: ['ledger.periods.view'],
  },
]

export default features
