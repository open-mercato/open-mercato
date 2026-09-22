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

const ROOT = path.resolve(__dirname, '..', '..')

// Mirrors jest.config.cjs's moduleNameMapper entries for
// `^@open-mercato/shared/(.*)$` and `^#generated/(.*)$`.
const ALIASES = [
  { test: /^@open-mercato\/shared\/(.*)$/, to: (m) => path.join(ROOT, 'packages/shared/src', m[1]) },
  { test: /^#generated\/(.*)$/, to: (m) => path.join(ROOT, 'packages/core/generated', m[1]) },
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
