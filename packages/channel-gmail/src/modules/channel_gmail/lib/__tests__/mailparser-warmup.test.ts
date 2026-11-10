/**
 * mailparser warm-up guard (#6040).
 *
 * `normalizeInboundGmailMessage` resolves `mailparser` lazily, inside the
 * function. Without the root warm-up in `jest.setup.ts` the cold module-graph
 * load therefore lands inside whichever test first parses a MIME message, and
 * competes with jest's default 5000 ms per-test budget — which is what made
 * three tests fail intermittently on CI while every sibling passed.
 *
 * Jest gives every test file its own module registry, and `require.cache`
 * reflects that registry. This file imports nothing, so an entry for
 * `mailparser` can only have been put there by the warm-up — making it a direct
 * observation of the property the flaky tests depend on, rather than a timing
 * assertion that would itself be flaky.
 *
 * Note this reads the CommonJS registry, which is what ts-jest's transform
 * produces today. Should that ever emit native ESM dynamic imports, the
 * warm-up would still work but this assertion would need rewriting — it fails
 * closed, so the breakage is loud rather than silent.
 */
describe('mailparser warm-up', () => {
  it('resolves mailparser before any test body runs', () => {
    expect(require.cache[require.resolve('mailparser')]).toBeDefined()
  })
})
