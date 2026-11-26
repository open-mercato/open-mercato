import { createHash } from 'node:crypto'

export type RespScript = {
  name: string
  source: string
  sha: string
}

function defineScript(name: string, source: string): RespScript {
  return { name, source, sha: createHash('sha1').update(source).digest('hex') }
}

/**
 * Compare-and-delete a batch of entries. For every entry ARGV carries
 * `(sha1 of the observed value bytes, member, tag-key count)` and KEYS carries
 * the value key followed by that many tag keys. An entry is deleted, and its
 * member removed from those tag sets, only while its stored bytes still hash to
 * the observed digest; a concurrent rewrite or retag is left untouched.
 */
export const DELETE_IF_UNCHANGED = defineScript('om_cache_delete_if_unchanged', `
local removed = 0
local keyIndex = 1
local argIndex = 1
while argIndex <= #ARGV do
  local expected = ARGV[argIndex]
  local member = ARGV[argIndex + 1]
  local tagCount = tonumber(ARGV[argIndex + 2])
  local current = redis.call('GET', KEYS[keyIndex])
  if current and redis.sha1hex(current) == expected then
    redis.call('DEL', KEYS[keyIndex])
    for offset = 1, tagCount do
      redis.call('SREM', KEYS[keyIndex + offset], member)
    end
    removed = removed + 1
  end
  keyIndex = keyIndex + 1 + tagCount
  argIndex = argIndex + 3
end
return removed
`)

/**
 * Drop stale members from ONE tag set. KEYS[1] is the tag key, KEYS[2..] the
 * member value keys; ARGV holds `(member, expected digest)` pairs where an empty
 * digest means "value key must be absent". A member is removed only while its
 * value is still absent or still the observed bytes whose tags exclude this tag,
 * so a concurrent write that re-adds the tag keeps its membership.
 */
export const REAP_TAG_MEMBERS = defineScript('om_cache_reap_tag_members', `
local removed = 0
for keyIndex = 2, #KEYS do
  local argIndex = (keyIndex - 1) * 2 - 1
  local member = ARGV[argIndex]
  local expected = ARGV[argIndex + 1]
  local current = redis.call('GET', KEYS[keyIndex])
  local stale
  if expected == '' then
    stale = (current == false)
  else
    stale = (current ~= false and redis.sha1hex(current) == expected)
  end
  if stale then
    removed = removed + redis.call('SREM', KEYS[1], member)
  end
end
return removed
`)

/**
 * Write one entry and its tag memberships atomically. KEYS[1] is the value key,
 * KEYS[2..] the tag keys; ARGV is `(payload, ttl ms or '' for no TTL, member)`.
 * A tag set lives at least as long as its longest-lived member: a fresh set
 * takes the entry TTL, an existing volatile set only ever extends, and a
 * member without TTL makes the set persistent. Plain Lua instead of
 * `PEXPIRE … GT` because KeyDB 6.3 (Redis 6.2 base) has no GT flag.
 */
export const WRITE_ENTRY = defineScript('om_cache_write_entry', `
local ttl = tonumber(ARGV[2])
if ttl then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
else
  redis.call('SET', KEYS[1], ARGV[1])
end
for index = 2, #KEYS do
  local tagKey = KEYS[index]
  local current = redis.call('PTTL', tagKey)
  redis.call('SADD', tagKey, ARGV[3])
  if not ttl then
    if current >= 0 then
      redis.call('PERSIST', tagKey)
    end
  elseif current == -2 or (current >= 0 and current < ttl) then
    redis.call('PEXPIRE', tagKey, ttl)
  end
end
return 1
`)

export const RESP_SCRIPTS: ReadonlyArray<RespScript> = [DELETE_IF_UNCHANGED, REAP_TAG_MEMBERS, WRITE_ENTRY]

export function sha1Hex(raw: Buffer | string): string {
  return createHash('sha1').update(raw).digest('hex')
}
