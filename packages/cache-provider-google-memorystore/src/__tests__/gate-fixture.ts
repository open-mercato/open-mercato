export const GATE_FIXTURE = {
  validSettings: {
    product: 'valkey',
    clusterMode: 'enabled',
    discoveryEndpoint: { host: '10.0.0.3' },
    auth: { kind: 'iam' },
    tls: { ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n' },
  },
} as const
