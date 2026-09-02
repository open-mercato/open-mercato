export const integrationMeta = {
  description: 'Enterprise privacy administration UI, retention, legal hold, subject request, and environment sanitization API coverage',
  dependsOnModules: ['data_erasure', 'audit_logs', 'auth', 'customers'],
  requiredEnvVars: ['OM_ENABLE_ENTERPRISE_MODULES_DATA_ERASURE'],
}
