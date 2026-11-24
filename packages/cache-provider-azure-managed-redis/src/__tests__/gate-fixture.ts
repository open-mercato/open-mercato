export const GATE_FIXTURE = {
  validSettings: {
    clusteringPolicy: 'non-clustered',
    host: 'om-cache.westeurope.redis.azure.net',
    auth: { kind: 'entra', identity: 'managed-identity' },
  },
} as const
