import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The optimistic lock was check-then-write, with the check outside the transaction.
 *
 * Both saves read the same `updated_at`, both passed the check, both entered their own transaction, and the
 * second overwrote the first with no conflict reported — the one outcome the lock exists to prevent. The
 * window is exactly as wide as everything between the check and the commit, which on a campaign save includes
 * validating the graph and replacing the triggers.
 *
 * A `pessimistic_write` lock makes the loser wait for the winner's commit, and re-reading the version after
 * that has the loser see the row it is about to destroy. Through the same platform helper, so the 409 body,
 * the conflict bar and the `OM_OPTIMISTIC_LOCK` contract are unchanged — the only difference is that this one
 * cannot be raced.
 *
 * Asserted against the source: a race is what a unit test with a fake entity manager cannot stage, and the
 * integration suite cannot reliably interleave two commits either.
 */
const source = readFileSync(join(__dirname, '..', 'campaigns.ts'), 'utf8')
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** Every `em.transactional` block in the file, so a new one cannot quietly skip the lock. */
const transactions = [...code.matchAll(/em\.transactional\(async \(tx\) => \{([\s\S]*?)\n    \}\)/g)]
  .map((match) => match[1])

describe('campaign writes that rewrite a definition', () => {
  it('finds the transactions it is meant to be guarding', () => {
    expect(transactions.length).toBeGreaterThanOrEqual(2)
  })

  for (const [index, body] of transactions.entries()) {
    it(`transaction ${index + 1} takes a write lock on the campaign row`, () => {
      expect(body).toContain('LockMode.PESSIMISTIC_WRITE')
    })

    it(`transaction ${index + 1} re-asserts the expected version inside the lock`, () => {
      // Outside it the check is advisory: the row can change between reading it and writing it.
      expect(body).toContain('enforceCommandOptimisticLockWithGuards(')
      expect(body).toContain('current: managed.updatedAt')
    })
  }

  it('keeps the outer check as well, so a stale save fails before any work is done', () => {
    // Cheap rejection first: no point validating a graph and replacing triggers for a save that cannot land.
    expect((code.match(/enforceCommandOptimisticLockWithGuards\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })
})
