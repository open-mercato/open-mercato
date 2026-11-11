export const features = [
  { id: 'cart.carts.view', title: 'View carts', module: 'cart' },
  { id: 'cart.carts.manage', title: 'Manage carts (reprice, expire)', module: 'cart', dependsOn: ['cart.carts.view'] },
  { id: 'cart.settings.manage', title: 'Manage cart settings', module: 'cart' },
  { id: 'cart.proposals.author', title: 'Author proposal carts', module: 'cart' },
  { id: 'cart.proposals.view', title: 'View proposal carts', module: 'cart' },
  // §6a.4: gate which authenticated principal may call `cart.create` with that specific
  // non-storefront channel — a storefront cart never needs these (it is always the public,
  // unauthenticated path). Independent of each other and of `cart.carts.*`: a POS integration
  // holding `cart.channel.pos` has no need to view/manage admin cart inspection and vice versa.
  { id: 'cart.channel.pos', title: 'Create POS carts', module: 'cart' },
  { id: 'cart.channel.payLink', title: 'Create pay-link carts', module: 'cart' },
  { id: 'cart.channel.agent', title: 'Create agent carts', module: 'cart' },
  { id: 'cart.channel.api', title: 'Create API carts', module: 'cart' },
]

export default features
