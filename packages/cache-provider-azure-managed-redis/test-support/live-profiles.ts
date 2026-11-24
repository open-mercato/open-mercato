import { readFileSync } from 'node:fs'
import type { LiveEnv, LiveProfile } from './live'

function optionalNumber(env: LiveEnv, name: string): number | undefined {
  const raw = env[name]?.trim()
  return raw ? Number(raw) : undefined
}

export const LIVE_PROFILES: LiveProfile[] = [
  {
    id: 'azure-nonclustered-entra-tls',
    description: 'Azure Managed Redis, Non-clustered policy, Microsoft Entra authentication, TLS',
    required: ['OM_CACHE_LIVE_AZURE_HOST', 'OM_CACHE_LIVE_AZURE_IDENTITY'],
    optional: ['OM_CACHE_LIVE_AZURE_PORT', 'OM_CACHE_LIVE_AZURE_CLIENT_ID', 'OM_CACHE_LIVE_AZURE_OBJECT_ID', 'OM_CACHE_LIVE_AZURE_CA_FILE'],
    settings(env) {
      const port = optionalNumber(env, 'OM_CACHE_LIVE_AZURE_PORT')
      const caFile = env.OM_CACHE_LIVE_AZURE_CA_FILE?.trim()
      return {
        clusteringPolicy: 'non-clustered',
        host: env.OM_CACHE_LIVE_AZURE_HOST,
        ...(port !== undefined ? { port } : {}),
        auth: {
          kind: 'entra',
          identity: env.OM_CACHE_LIVE_AZURE_IDENTITY,
          ...(env.OM_CACHE_LIVE_AZURE_CLIENT_ID ? { clientId: env.OM_CACHE_LIVE_AZURE_CLIENT_ID } : {}),
          ...(env.OM_CACHE_LIVE_AZURE_OBJECT_ID ? { objectId: env.OM_CACHE_LIVE_AZURE_OBJECT_ID } : {}),
        },
        tls: caFile ? { ca: readFileSync(caFile, 'utf8') } : {},
        connectTimeoutMs: 10_000,
        commandTimeoutMs: 5_000,
      }
    },
  },
]
