// The currency dictionary is seeded by the customers module's seedDefaults,
// while the unit dictionary is seeded by catalog. Gate this test on both so it
// is excluded when either module is disabled.
export const integrationMeta = {
  dependsOnModules: ['catalog', 'customers'],
}
