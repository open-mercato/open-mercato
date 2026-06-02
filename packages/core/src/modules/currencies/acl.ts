export const features = [
  {
    id: 'currencies.view',
    title: 'View currencies',
    module: 'currencies',
  },
  {
    id: 'currencies.manage',
    title: 'Manage currencies',
    module: 'currencies',
    dependsOn: ['currencies.view'],
  },
  {
    id: 'currencies.rates.view',
    title: 'View exchange rates',
    module: 'currencies',
    dependsOn: ['currencies.view'],
  },
  {
    id: 'currencies.rates.manage',
    title: 'Manage exchange rates',
    module: 'currencies',
    dependsOn: ['currencies.rates.view'],
  },
  {
    id: 'currencies.fetch.view',
    title: 'View currency fetch configuration',
    module: 'currencies',
    dependsOn: ['currencies.view'],
  },
  {
    id: 'currencies.fetch.manage',
    title: 'Manage currency fetch configuration',
    module: 'currencies',
    dependsOn: ['currencies.fetch.view'],
  },
]

export default features
