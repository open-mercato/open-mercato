import infinispan from 'infinispan'
import { decodeEntryRecord, decodeTagShard, entryKeyPrefix, indexedTags, tagKeyPrefix, tagShardIndex, tagShardKey, type TagShard } from '../../layout'

export type IndexAudit = { entries: number; shards: number; missingMemberships: string[] }

export async function auditTagIndex(
  server: { host: string; port: number },
  options: Record<string, unknown>,
  namespace: string,
  shards: number,
): Promise<IndexAudit> {
  const admin = await infinispan.client(server, options)
  const entries = new Map<string, NonNullable<ReturnType<typeof decodeEntryRecord>>>()
  const shardMap = new Map<string, TagShard>()
  try {
    const iterator = await admin.iterator(200)
    for (;;) {
      const step = await iterator.next()
      if (step.done) break
      const key = String(step.key)
      if (key.startsWith(entryKeyPrefix(namespace))) {
        const record = decodeEntryRecord(step.value)
        if (record) entries.set(key.slice(entryKeyPrefix(namespace).length), record)
      } else if (key.startsWith(tagKeyPrefix(namespace))) {
        const shard = decodeTagShard(step.value)
        if (shard) shardMap.set(key, shard)
      }
    }
    await iterator.close()
  } finally {
    await admin.disconnect()
  }
  const missingMemberships: string[] = []
  for (const [physicalKey, record] of entries) {
    for (const tag of indexedTags(physicalKey, record.tags)) {
      const member = shardMap.get(tagShardKey(namespace, tag, tagShardIndex(physicalKey, shards), shards))?.get(physicalKey)
      if (!member || member.writeId !== record.writeId) missingMemberships.push(`${physicalKey} -> ${tag}`)
    }
  }
  return { entries: entries.size, shards: shardMap.size, missingMemberships }
}
