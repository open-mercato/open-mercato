import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { campaignEnabledSchema, campaignGraphSaveSchema } from '../../data/validators'

/**
 * A client cannot claim a restore that never happened, and may send its version as a header.
 *
 * The route spread the request body straight into the command, and the command threads `restoredFrom` into the
 * revision note — so `{"restoredFrom": 7}` made the history read "restored:7" for a save that restored
 * nothing. The version list is the one record an author trusts when they are trying to undo something.
 *
 * `restoredFrom` is internal: the restore endpoint sets it by calling the command directly.
 */
const ROUTE = readFileSync(join(__dirname, '..', 'campaigns', '[id]', 'save-graph', 'route.ts'), 'utf8')
const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the save-graph route', () => {
  it('names the fields it forwards instead of spreading the body', () => {
    expect(/input:\s*\{\s*\.\.\./.test(code)).toBe(false)
    expect(code).toContain('definition: payload.definition')
  })

  it('never forwards restoredFrom', () => {
    expect(code).not.toContain('restoredFrom')
  })

  it('forwards nothing the schema does not define', () => {
    // A whitelist rather than a blacklist: the next internal-only field is protected by this shape, not by
    // somebody remembering to exclude it.
    const forwarded = /input:\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    const keys = [...forwarded.matchAll(/(\w+):/g)].map((match) => match[1])
    const allowed = new Set(['id', ...Object.keys(campaignGraphSaveSchema.shape)])
    expect(keys.filter((key) => !allowed.has(key))).toEqual([])
  })
})

/**
 * The expected version travels in the body OR the header, because the platform's helper accepts either — and
 * the header is what `buildOptimisticLockHeader` sends, so requiring the body field answered 400 to a caller
 * doing it the documented way. Restoring a revision was one such caller.
 */
describe('the lock version', () => {
  it('is optional in both save schemas', () => {
    expect(campaignGraphSaveSchema.safeParse({
      name: 'x', triggers: [], definition: { version: 1 as const },
    }).success).toBe(true)
    expect(campaignEnabledSchema.safeParse({ isEnabled: true }).success).toBe(true)
  })

  it('is still refused when present and empty', () => {
    /**
     * Optional is not a default. The helper falls back to the header only when the value is ABSENT, so an
     * empty string is a present value matching nothing — it switches the lock off rather than weakening it,
     * which is the rule `AGENTS.md` states and the results screen had broken.
     */
    expect(campaignGraphSaveSchema.safeParse({
      updatedAt: '', name: 'x', triggers: [], definition: { version: 1 as const },
    }).success).toBe(false)
    expect(campaignEnabledSchema.safeParse({ updatedAt: '', isEnabled: true }).success).toBe(false)
  })

  it('is accepted when sent properly', () => {
    expect(campaignEnabledSchema.safeParse({ updatedAt: '2026-10-02T12:00:00.000Z', isEnabled: true }).success).toBe(true)
  })
})
