// Price kinds need a currency seeded by the customers module's seedDefaults,
// and the unit dictionary is seeded by catalog. Gate this test on both so it
// is excluded when either module is disabled.
export const integrationMeta = {
  dependsOnModules: ['catalog', 'customers'],
}
