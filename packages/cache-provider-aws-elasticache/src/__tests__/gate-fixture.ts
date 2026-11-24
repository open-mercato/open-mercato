export const GATE_FIXTURE = {
  validSettings: {
    engine: 'valkey',
    deployment: 'node-based',
    clusterMode: 'disabled',
    host: 'master.om-cache.abc123.euw1.cache.amazonaws.com',
    auth: { kind: 'iam', userId: 'om-cache', replicationGroupId: 'om-cache', region: 'eu-west-1' },
  },
} as const
