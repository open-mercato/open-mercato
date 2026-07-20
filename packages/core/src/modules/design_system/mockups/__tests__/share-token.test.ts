import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  mintShareToken,
  resolveSharedMockup,
  SHARE_MAX_EXPIRY_DAYS,
  verifyShareToken,
} from '../share'

/**
 * Share-token adversarial cases (Phase 2, spec security constraints): expired,
 * tampered, malformed, wrong-secret, and wrong-document tokens must all
 * collapse into ONE uniform failure shape at the handler level — no oracle.
 */

const SECRET = 'test-secret-for-mockup-share'
const NOW = new Date('2026-07-20T12:00:00Z')

const FIXTURE = {
  version: 1,
  slug: 'share-fixture',
  title: 'Share fixture',
  root: { type: 'block', id: 'b1', entry: 'table', variant: 'default', status: 'implemented' },
}

function makeTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-mockup-share-'))
  const dir = path.join(root, '.ai', 'mockups')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(root, 'yarn.lock'), '', 'utf8')
  fs.writeFileSync(
    path.join(dir, 'share-fixture.mockup.json'),
    `${JSON.stringify(FIXTURE, null, 2)}\n`,
    'utf8',
  )
  return root
}

describe('design_system mockup share tokens', () => {
  it('round-trips a freshly minted token', () => {
    const { token, expiresAt } = mintShareToken('share-fixture', 7, SECRET, NOW)
    expect(new Date(expiresAt).getTime()).toBe(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)
    const verified = verifyShareToken(token, SECRET, NOW)
    expect(verified).toEqual({ ok: true, slug: 'share-fixture' })
  })

  it('clamps expiry to the 30-day maximum', () => {
    const { expiresAt } = mintShareToken('share-fixture', 3650, SECRET, NOW)
    expect(new Date(expiresAt).getTime()).toBe(
      NOW.getTime() + SHARE_MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    )
  })

  it('rejects an expired token', () => {
    const { token } = mintShareToken('share-fixture', 1, SECRET, NOW)
    const later = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000)
    expect(verifyShareToken(token, SECRET, later)).toEqual({ ok: false })
  })

  it('rejects a tampered token (payload bit-flip keeps the signature stale)', () => {
    const { token } = mintShareToken('share-fixture', 7, SECRET, NOW)
    const [payload, signature] = token.split('.')
    const flipped = (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1)
    expect(verifyShareToken(`${flipped}.${signature}`, SECRET, NOW)).toEqual({ ok: false })
  })

  it('rejects a re-signed payload under a different secret', () => {
    const { token } = mintShareToken('share-fixture', 7, 'other-secret', NOW)
    expect(verifyShareToken(token, SECRET, NOW)).toEqual({ ok: false })
  })

  it('rejects malformed tokens and refuses everything without a secret', () => {
    for (const garbage of ['', 'x', 'a.b.c', 'not-base64.!!', '..']) {
      expect(verifyShareToken(garbage, SECRET, NOW)).toEqual({ ok: false })
    }
    const { token } = mintShareToken('share-fixture', 7, SECRET, NOW)
    expect(verifyShareToken(token, null, NOW)).toEqual({ ok: false })
  })

  it('handler-level uniformity: expired, tampered, and wrong-document tokens resolve identically', () => {
    const repoRoot = makeTempRepo()
    try {
      const good = mintShareToken('share-fixture', 7, SECRET, NOW).token
      expect(resolveSharedMockup(good, SECRET, repoRoot, NOW).ok).toBe(true)

      const expired = mintShareToken('share-fixture', 1, SECRET, NOW).token
      const wrongDocument = mintShareToken('no-such-mockup', 7, SECRET, NOW).token
      const [payload, signature] = good.split('.')
      const tampered = `${(payload[0] === 'A' ? 'B' : 'A') + payload.slice(1)}.${signature}`

      const failures = [
        resolveSharedMockup(expired, SECRET, repoRoot, new Date(NOW.getTime() + 2 * 86400 * 1000)),
        resolveSharedMockup(tampered, SECRET, repoRoot, NOW),
        resolveSharedMockup(wrongDocument, SECRET, repoRoot, NOW),
        resolveSharedMockup(good, null, repoRoot, NOW),
      ]
      // One uniform shape — nothing distinguishes the failure classes.
      for (const failure of failures) expect(failure).toEqual({ ok: false })
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('a token authorizes exactly its slug — nothing else resolves', () => {
    const repoRoot = makeTempRepo()
    try {
      const verified = verifyShareToken(mintShareToken('share-fixture', 7, SECRET, NOW).token, SECRET, NOW)
      expect(verified).toEqual({ ok: true, slug: 'share-fixture' })
      // The resolution path only ever loads the token's own slug; a token for
      // another slug cannot surface this document.
      const other = mintShareToken('some-other-slug', 7, SECRET, NOW).token
      expect(resolveSharedMockup(other, SECRET, repoRoot, NOW)).toEqual({ ok: false })
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
