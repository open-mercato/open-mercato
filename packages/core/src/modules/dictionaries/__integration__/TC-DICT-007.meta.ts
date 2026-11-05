// The protected currency dictionary is seeded by the customers module's
// seedDefaults (seedCurrencyDictionary), so this test only runs when both the
// dictionaries and customers modules are enabled.
export const integrationMeta = {
  dependsOnModules: ['dictionaries', 'customers'],
};
