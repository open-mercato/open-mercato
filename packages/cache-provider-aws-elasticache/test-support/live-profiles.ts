import { readFileSync } from 'node:fs'
import type { LiveEnv, LiveProfile } from './live'

function optionalNumber(env: LiveEnv, name: string): number | undefined {
  const raw = env[name]?.trim()
  return raw ? Number(raw) : undefined
}

export const LIVE_PROFILES: LiveProfile[] = [
  {
    id: 'aws-valkey-node-cmd-disabled-iam-tls',
    description: 'Amazon ElastiCache, node-based Valkey, cluster mode disabled, IAM authentication, TLS',
    required: ['OM_CACHE_LIVE_AWS_PRIMARY_HOST', 'OM_CACHE_LIVE_AWS_USER_ID', 'OM_CACHE_LIVE_AWS_REPLICATION_GROUP_ID', 'OM_CACHE_LIVE_AWS_REGION'],
    optional: ['OM_CACHE_LIVE_AWS_PORT', 'OM_CACHE_LIVE_AWS_CA_FILE'],
    settings(env) {
      const port = optionalNumber(env, 'OM_CACHE_LIVE_AWS_PORT')
      const caFile = env.OM_CACHE_LIVE_AWS_CA_FILE?.trim()
      return {
        engine: 'valkey',
        deployment: 'node-based',
        clusterMode: 'disabled',
        host: env.OM_CACHE_LIVE_AWS_PRIMARY_HOST,
        ...(port !== undefined ? { port } : {}),
        auth: {
          kind: 'iam',
          userId: env.OM_CACHE_LIVE_AWS_USER_ID,
          replicationGroupId: env.OM_CACHE_LIVE_AWS_REPLICATION_GROUP_ID,
          region: env.OM_CACHE_LIVE_AWS_REGION,
        },
        tls: caFile ? { ca: readFileSync(caFile, 'utf8') } : {},
        connectTimeoutMs: 10_000,
        commandTimeoutMs: 5_000,
      }
    },
  },
]
