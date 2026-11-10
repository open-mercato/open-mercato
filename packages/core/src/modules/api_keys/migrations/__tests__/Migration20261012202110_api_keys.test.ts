/**
 * #2254 review (blocker): dropping `session_token` in the same migration that adds
 * `session_token_hash` would null out every in-flight AI-chat session (2-hour TTL, minted once
 * per conversation) with no automatic re-mint. These tests pin the corrected migration's shape:
 * backfill the hash from the still-present plaintext column, scrub the legacy `name` leak, THEN
 * clear the plaintext — and never drop the column outright.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(__dirname, '..', 'Migration20261012202110_api_keys.ts')

function upSection(source: string): string {
  const start = source.indexOf('override async up()')
  const end = source.indexOf('override down()')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function downSection(source: string): string {
  const start = source.indexOf('override down()')
  expect(start).toBeGreaterThanOrEqual(0)
  return source.slice(start)
}

describe('Migration20261012202110_api_keys', () => {
  const source = readFileSync(migrationPath, 'utf8')
  const up = upSection(source)
  const down = downSection(source)

  it('adds the hash column before touching any data', () => {
    expect(up).toContain('alter table "api_keys" add "session_token_hash" text null')
  })

  it('backfills the hash from the still-present plaintext token using a PostgreSQL built-in', () => {
    // sha256() is PostgreSQL 13+ core (no pgcrypto dependency) and must match
    // hashSessionToken's createHash('sha256').update(token).digest('hex') byte for byte.
    expect(up).toContain('encode(sha256("session_token"::bytea), \'hex\')')
    expect(up).toContain('where "session_token" is not null and "session_token_hash" is null')
  })

  it('scrubs the legacy name-embedded raw token before the token itself is cleared', () => {
    expect(up).toContain('__session_\' || substr("session_token_hash", 1, 12) || \'__')
  })

  it('clears the plaintext token but never drops the column', () => {
    expect(up).toContain('set "session_token" = null where "session_token" is not null')
    expect(up).not.toMatch(/drop column "session_token"[^_]/)
    expect(up).not.toContain('drop column "session_token";')
  })

  it('orders backfill → name scrub → plaintext clear → unique index', () => {
    const backfillIdx = up.indexOf('session_token_hash" = encode')
    const scrubIdx = up.indexOf('__session_\' || substr')
    const clearIdx = up.indexOf('set "session_token" = null')
    const indexIdx = up.indexOf('create unique index "api_keys_session_token_hash_uq"')

    expect(backfillIdx).toBeGreaterThanOrEqual(0)
    expect(scrubIdx).toBeGreaterThan(backfillIdx)
    expect(clearIdx).toBeGreaterThan(scrubIdx)
    expect(indexIdx).toBeGreaterThan(clearIdx)
  })

  it('reverses only the added schema, not the (unrestorable) cleared data', () => {
    expect(down).toContain('drop index "api_keys_session_token_hash_uq"')
    expect(down).toContain('drop column "session_token_hash"')
    expect(down).not.toContain('session_token"')
  })
})
