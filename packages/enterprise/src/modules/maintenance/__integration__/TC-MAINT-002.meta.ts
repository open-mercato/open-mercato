export const integrationMeta = {
  description: 'Flips instance-wide maintenance mode through the real CLI; every concurrent test would receive 503, so it runs only in an exclusive run that shares the app state store',
  requiredEnvVars: ['OM_INTEGRATION_MAINTENANCE_EXCLUSIVE'],
}
