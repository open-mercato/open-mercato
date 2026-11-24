import {
  decodeEntryRecord,
  decodeTagShard,
  encodeEntryRecord,
  encodeTagShard,
  entryKey,
  isMemberReclaimable,
  isNamespaceKey,
  physicalKeyFromEntryKey,
  tagShardIndex,
  tagShardKey,
  tagShardKeysFor,
  tagShardLifespanMs,
} from '../layout'

describe('infinispan key layout', () => {
  it('fences entries and tag shards under the versioned namespace prefix', () => {
    expect(entryKey('prod-eu', 'tenant:t1:key:k:abc')).toBe('prod-eu:v1:k:tenant:t1:key:k:abc')
    expect(tagShardKey('prod-eu', 'tenant:t1:tag:x', 3, 16)).toBe('prod-eu:v1:t:16:3:tenant:t1:tag:x')
    expect(physicalKeyFromEntryKey('prod-eu', 'prod-eu:v1:k:a:b')).toBe('a:b')
    expect(physicalKeyFromEntryKey('prod-eu', 'prod-eu-2:v1:k:a:b')).toBeNull()
    expect(isNamespaceKey('prod', 'prod:v1:t:1:0:x')).toBe(true)
    expect(isNamespaceKey('prod', 'production:v1:k:x')).toBe(false)
    expect(tagShardKeysFor('ns', 'tag', 3)).toEqual(['ns:v1:t:3:0:tag', 'ns:v1:t:3:1:tag', 'ns:v1:t:3:2:tag'])
  })

  it('maps keys to stable shards within range', () => {
    const seen = new Set<number>()
    for (let index = 0; index < 500; index++) {
      const shard = tagShardIndex(`key-${index}`, 16)
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(16)
      expect(tagShardIndex(`key-${index}`, 16)).toBe(shard)
      seen.add(shard)
    }
    expect(seen.size).toBe(16)
    expect(tagShardIndex('anything', 1)).toBe(0)
  })

  it('round-trips entry records and rejects corrupt ones', () => {
    const record = { writeId: 'w1', tags: ['a', 'b'], expiresAt: 123, encoding: 'base64' as const, payload: 'AAEC' }
    expect(decodeEntryRecord(encodeEntryRecord(record))).toEqual(record)
    expect(decodeEntryRecord('{"f":1,"w":"x"')).toBeNull()
    expect(decodeEntryRecord('{"f":2,"w":"x","t":[],"x":null,"e":"t","d":""}')).toBeNull()
    expect(decodeEntryRecord('{"f":1,"w":"x","t":[1],"x":null,"e":"t","d":""}')).toBeNull()
    expect(decodeEntryRecord(undefined)).toBeNull()
  })

  it('round-trips tag shards and computes reclaimability and lifespans', () => {
    const shard = new Map([
      ['k1', { writeId: 'a', writtenAt: 10, expiresAt: 100 }],
      ['k2', { writeId: 'b', writtenAt: 20, expiresAt: 300 }],
    ])
    expect(decodeTagShard(encodeTagShard(shard))).toEqual(shard)
    expect(decodeTagShard('{"f":1,"m":{"k":["w"]}}')).toBeNull()
    expect(tagShardLifespanMs(shard, 50, 1000)).toBe(1250)
    shard.set('k3', { writeId: 'c', writtenAt: 30, expiresAt: null })
    expect(tagShardLifespanMs(shard, 50, 1000)).toBeNull()
    expect(isMemberReclaimable({ writeId: 'a', writtenAt: 0, expiresAt: 100 }, 1200, 1000)).toBe(true)
    expect(isMemberReclaimable({ writeId: 'a', writtenAt: 0, expiresAt: 100 }, 1000, 1000)).toBe(false)
    expect(isMemberReclaimable({ writeId: 'a', writtenAt: 0, expiresAt: null }, 1e12, 1000)).toBe(false)
  })
})
