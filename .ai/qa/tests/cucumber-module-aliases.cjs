// Registers the same bare-specifier -> source-path aliases that
// `jest.config.cjs`'s own `moduleNameMapper` uses, so `cucumber-js` can
// `require()` the ledger module's REAL command files the same way Jest's
// unit tests do.
//
// Why this exists: `@open-mercato/shared`'s package.json `exports`/`main`
// point at `./dist/...` (compiled output). That `dist/` directory is empty
// in every environment this BDD suite has been developed in so far (no
// `yarn build` has run — see the module README, "Verification status").
// Plain Node module resolution would therefore fail to load
// `@open-mercato/shared/lib/commands` etc. Jest never hits this problem
// because `jest.config.cjs` maps those specifiers straight to
// `packages/shared/src/...` (TypeScript source) instead of `dist`. This
// file reproduces that same mapping for `cucumber-js`, restricted to the
// specifiers the ledger module's `postJournalEntry`/`reverseJournalEntry`/
// `fiscalPeriods` commands actually import — it is not a general-purpose
// port of the whole Jest config.
//
// Loaded as a `requireModule` entry in cucumber.config.cjs, AFTER
// `tsx/cjs` (so the `.ts` extension is already require()-able) and BEFORE
// any step definition or support file requires a real command module.
const path = require('path')
const Module = require('module')

const ROOT = path.resolve(__dirname, '..', '..', '..')

// Mirrors jest.config.cjs's moduleNameMapper entries in full (not just
// the ones the ledger commands import directly): resolveTranslations()'s
// own import chain (../modules/registry, app-dictionaries,
// dictionary-cache, etc.) transitively reaches other workspace packages
// too (confirmed by running this suite for real and hitting
// `@open-mercato/cache` — see the README's "Verification status", now
// updated after that run). Copying the whole table, exactly as
// jest.config.cjs defines it, is safer than guessing which subset a given
// command's dependency graph happens to need.
const ALIASES = [
  { test: /^#generated\/(.*)$/, to: (m) => path.join(ROOT, 'packages/core/generated', m[1]) },
  { test: /^@open-mercato\/core\/generated\/(.*)$/, to: (m) => path.join(ROOT, 'packages/core/generated', m[1]) },
  { test: /^@open-mercato\/core\/(.*)$/, to: (m) => path.join(ROOT, 'packages/core/src', m[1]) },
  { test: /^@open-mercato\/content\/(.*)$/, to: (m) => path.join(ROOT, 'packages/content/src', m[1]) },
  { test: /^@open-mercato\/cli\/(.*)$/, to: (m) => path.join(ROOT, 'packages/cli/src', m[1]) },
  { test: /^@open-mercato\/events\/(.*)$/, to: (m) => path.join(ROOT, 'packages/events/src', m[1]) },
  { test: /^@open-mercato\/cache\/(.*)$/, to: (m) => path.join(ROOT, 'packages/cache/src', m[1]) },
  { test: /^@open-mercato\/cache$/, to: () => path.join(ROOT, 'packages/cache/src/index.ts') },
  { test: /^@open-mercato\/queue\/worker$/, to: () => path.join(ROOT, 'packages/queue/src/worker/runner.ts') },
  { test: /^@open-mercato\/queue\/(.*)$/, to: (m) => path.join(ROOT, 'packages/queue/src', m[1]) },
  { test: /^@open-mercato\/queue$/, to: () => path.join(ROOT, 'packages/queue/src/index.ts') },
  { test: /^@open-mercato\/search\/(.*)$/, to: (m) => path.join(ROOT, 'packages/search/src', m[1]) },
  { test: /^@open-mercato\/search$/, to: () => path.join(ROOT, 'packages/search/src/index.ts') },
  { test: /^@open-mercato\/ai-assistant\/(.*)$/, to: (m) => path.join(ROOT, 'packages/ai-assistant/src', m[1]) },
  { test: /^@open-mercato\/ai-assistant$/, to: () => path.join(ROOT, 'packages/ai-assistant/src/index.ts') },
  { test: /^@open-mercato\/shared\/(.*)$/, to: (m) => path.join(ROOT, 'packages/shared/src', m[1]) },
  { test: /^@open-mercato\/ui\/(.*)$/, to: (m) => path.join(ROOT, 'packages/ui/src', m[1]) },
]

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  for (const alias of ALIASES) {
    const match = request.match(alias.test)
    if (match) {
      const target = alias.to(match)
      return originalResolveFilename.call(this, target, ...rest)
    }
  }
  return originalResolveFilename.call(this, request, ...rest)
}
