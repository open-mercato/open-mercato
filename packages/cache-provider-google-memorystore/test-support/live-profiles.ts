import { readFileSync } from 'node:fs'
import type { LiveEnv, LiveProfile } from '@open-mercato/cache-provider-managed-kit/testing/live'

function optionalNumber(env: LiveEnv, name: string): number | undefined {
  const raw = env[name]?.trim()
  return raw ? Number(raw) : undefined
}

export const LIVE_PROFILES: LiveProfile[] = [
  {
    id: 'gcp-valkey-cluster-enabled-iam-tls',
    description: 'Memorystore for Valkey, cluster mode enabled, IAM authentication, TLS with server CA',
    required: ['OM_CACHE_LIVE_GCP_DISCOVERY_HOST', 'OM_CACHE_LIVE_GCP_SERVER_CA_FILE'],
    optional: ['OM_CACHE_LIVE_GCP_DISCOVERY_PORT', 'OM_CACHE_LIVE_GCP_TLS_SERVERNAME'],
    settings(env) {
      const port = optionalNumber(env, 'OM_CACHE_LIVE_GCP_DISCOVERY_PORT')
      const servername = env.OM_CACHE_LIVE_GCP_TLS_SERVERNAME?.trim()
      return {
        product: 'valkey',
        clusterMode: 'enabled',
        discoveryEndpoint: { host: env.OM_CACHE_LIVE_GCP_DISCOVERY_HOST, ...(port !== undefined ? { port } : {}) },
        auth: { kind: 'iam' },
        tls: { ca: readFileSync(env.OM_CACHE_LIVE_GCP_SERVER_CA_FILE!.trim(), 'utf8'), ...(servername ? { servername } : {}) },
        connectTimeoutMs: 10_000,
        commandTimeoutMs: 5_000,
      }
    },
  },
]
