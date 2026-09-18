// A node:test reporter that names a truncated run for what it is.
//
// When the runner is stopped before it finishes — `turbo run test` aborting siblings after another
// package's task failed, a killed process, an exhausted runner — node:test reports every file that
// never got to finish under `✖ failing tests:` with
// `'Promise resolution is still pending but the event loop has already resolved'`, while the summary
// says `fail 0`. Contributors read that as "26 create-app tests failed on my diff" and go looking in
// the wrong place (#5052). This reporter prints what actually happened, and what to do about it.
//
// The banner needs node:test's run-level `test:summary` event, which the documented CI truncation
// does emit (`Interrupted while running:` … `ℹ cancelled 27`). A process killed hard enough to die
// before that event — a SIGTERM/SIGKILL mid-run, or an abort while the runner has not started yet —
// prints node's own `Interrupted while running:` notice and nothing from here. That is the expected
// behaviour, not a reporter that failed to fire.
export default async function* reportTruncation(source) {
  for await (const event of source) {
    if (event.type !== 'test:summary') continue
    // Per-file summaries carry `file`; the run-level summary is the one without it.
    if (event.data.file) continue
    const { cancelled = 0, failed = 0, passed = 0 } = event.data.counts ?? {}
    if (cancelled === 0) continue
    yield [
      '',
      `⚠ create-mercato-app: this run was TRUNCATED — ${cancelled} test file(s) were cancelled before they finished`,
      `  (${passed} passed, ${failed} assertion failure(s)).`,
      failed === 0
        ? '  No assertion failed here: the cancelled files were stopped from outside, not by this suite.'
        : '  Fix the assertion failure(s) above first; the cancelled files never ran to completion.',
      '  Under `turbo run test` the usual cause is another package\'s test task failing, which aborts',
      '  every sibling task still running — look for the "Failed:" line in the turbo summary.',
      '  To judge this suite on its own: yarn workspace create-mercato-app test',
      '',
    ].join('\n')
  }
}
