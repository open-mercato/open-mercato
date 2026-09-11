// Warm the lazy `mailparser` import before any test body runs (issue #6040).
//
// `normalizeInboundGmailMessage` resolves `mailparser` lazily, inside the function, so the whole
// cold module-graph load is charged to whichever test first reaches it — against jest's default
// 5000 ms per-test budget. On a contended CI runner that load alone approaches the timeout, which
// made the first MIME-parsing test in a file fail intermittently while every sibling passed.
//
// Paying the load in a root `beforeAll` with an explicit, generous hook budget removes it from
// every test's budget without raising `testTimeout`, so a genuinely slow adapter regression still
// trips the 5000 ms default.
beforeAll(async () => {
  await import('mailparser')
}, 60_000)
