export const integrationMeta = {
  description: 'Enterprise tenant boundary with a restricted real application role',
  dependsOnModules: ['tenant_boundaries', 'customers', 'customer_accounts'],
  requiredEnvVars: ['OM_ENABLE_ENTERPRISE_MODULES'],
}
