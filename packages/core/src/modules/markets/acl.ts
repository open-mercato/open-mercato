export const features = [
  {
    id: 'markets.view',
    title: 'View market display profile',
    module: 'markets',
  },
  {
    id: 'markets.manage',
    title: 'Manage market display profile',
    module: 'markets',
    dependsOn: ['markets.view'],
  },
]

export default features
