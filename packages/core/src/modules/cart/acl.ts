export const features = [
  { id: 'cart.carts.view', title: 'View carts', module: 'cart' },
  { id: 'cart.carts.manage', title: 'Manage carts (reprice, expire)', module: 'cart', dependsOn: ['cart.carts.view'] },
  { id: 'cart.settings.manage', title: 'Manage cart settings', module: 'cart' },
  { id: 'cart.proposals.author', title: 'Author proposal carts', module: 'cart' },
  { id: 'cart.proposals.view', title: 'View proposal carts', module: 'cart' },
]

export default features
