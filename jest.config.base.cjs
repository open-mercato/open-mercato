/** @type {import('jest').Config} */
// Shared jest base config — governs the test-suite memory fan-out (issue #2402).
//
// `turbo run test` launches one jest "main" per package, and each main forks
// worker processes. Left uncapped, every package would default to
// `os.cpus().length - 1` workers, so the worst-case worker count is
// (packages × cores) — structurally unbounded and easily above the `yarn dev`
// RSS budget on smaller machines.
//
// This base pins the two per-package multipliers so peak RSS stays bounded:
//   peak ≈ (turboConcurrency × maxWorkers) × perWorkerHeapCap + mainOverhead
// Turbo concurrency and the per-worker V8 heap cap are pinned in the root
// `test` script; the worker count and recycling threshold are pinned here.
//
// Every package's jest.config.cjs spreads this first, then overrides specifics.

// Pin the suite's timezone so tests do not depend on where they run. A whole class of date bug
// — a calendar day stored as UTC midnight, read back in the local frame — renders the PREVIOUS
// day west of UTC and is INVISIBLE anywhere at or east of it, including the UTC runners on CI.
// Pinning west of UTC makes those cases fail in the one place that matters, and makes every
// other date assertion reproduce identically on a laptop and on CI.
//
// This has to happen here, in the config, rather than in a test file: jest hands each test file a
// sandboxed copy of `process.env`, so assigning `TZ` there never reaches V8's timezone cache. The
// config is evaluated in the real main process before workers fork, so workers boot in this zone.
//
// `||=`, not `=`: `TZ=Asia/Tokyo yarn test` stays available for checking the mirror direction
// (an instant read back in UTC, which names the NEXT day east of UTC).
process.env.TZ ||= 'America/New_York'

module.exports = {
  // TEMPORARY (TypeScript 7 migration): redirect `import ts from 'typescript'`
  // in test code to the JS-based `typescript-js` alias — native TS 7 drops the
  // JS compiler API. Packages spread this base first and do not override
  // `resolver`, so every suite inherits it. See scripts/jest-typescript-resolver.cjs.
  resolver: require.resolve('./scripts/jest-typescript-resolver.cjs'),
  // Cap workers per package so the turbo fan-out stays small
  // (turbo concurrency × maxWorkers heavy workers at peak).
  maxWorkers: 2,
  // Recycle a worker once its heap bloats past this, instead of letting it
  // grow toward V8's default ceiling for the whole run.
  workerIdleMemoryLimit: '512MB',
}
