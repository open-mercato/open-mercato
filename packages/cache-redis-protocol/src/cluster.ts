import type { Cluster } from 'ioredis'
import type { RespClient } from './client'

export function isClusterClient(client: RespClient): client is Cluster {
  return (client as { isCluster?: unknown }).isCluster === true
}
