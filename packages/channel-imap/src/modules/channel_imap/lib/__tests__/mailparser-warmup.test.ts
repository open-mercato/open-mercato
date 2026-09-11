// Guards the fix for issue #6040. `normalizeInboundImapMessage` resolves `mailparser` lazily, so
// without the root warm-up in jest.setup.ts the cold module-graph load lands inside whichever test
// first parses a MIME message and competes with jest's default 5000 ms per-test budget.
//
// Jest gives every test file its own module registry, and `require.cache` reflects that registry —
// so an entry for `mailparser` here means the warm-up ran before this test body, which is exactly
// the property the flaky tests depend on.
describe('mailparser warm-up', () => {
  it('resolves mailparser before any test body runs', () => {
    expect(require.cache[require.resolve('mailparser')]).toBeDefined()
  })
})
