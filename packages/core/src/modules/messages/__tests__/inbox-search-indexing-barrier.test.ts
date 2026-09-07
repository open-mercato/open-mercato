import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard for #5905. `?search=` on the messages list is resolved through the
 * asynchronously populated `search_tokens` index, and the list response is then
 * cached for 30s under a key derived from the parsed query without anything
 * invalidating it once the indexer catches up. An inbox search read straight
 * after composing is therefore a race, and re-reading the identical URL cannot
 * win it — the barrier has to poll AND vary the cache key.
 */
function integrationSource(fileName: string): string {
  return readFileSync(join(__dirname, '..', '__integration__', fileName), 'utf8')
}

describe('TC-API-MSG-001 inbox indexing barrier', () => {
  const source = integrationSource('TC-API-MSG-001.spec.ts')

  it('polls the inbox search instead of reading it once', () => {
    expect(source).toContain('await expect')
    expect(source).toContain('.poll(')
    expect(source).toContain('async function pollInboxItem(')
  })

  it('issues every inbox list request from inside the polling barrier', () => {
    const inboxRequestSites = source.match(/\/api\/messages\?folder=inbox/g) ?? []
    expect(inboxRequestSites).toHaveLength(1)
  })

  it('varies the cache key across poll attempts so a cached pre-index miss cannot be replayed', () => {
    expect(source).not.toMatch(/folder=inbox[^`]*pageSize=\d+/)
    expect(source).toContain('const pageSize = 20 + (attempt++ % 60)')
  })
})
