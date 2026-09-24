// Shared Cucumber.js config for the `ledger` module's BDD scenarios.
// Mirrors this file's sibling `playwright.config.ts`: only the *config*
// lives here, executable `.feature`/step-definition files stay module-local
// under `packages/core/src/modules/ledger/__bdd__/`.
//
// The `paths` entry below is a literal, non-wildcard-prefixed path rather
// than a repo-root glob like `**/*.feature`. This is deliberate, not an
// oversight: `cucumber-js`'s `paths` array does not support `!`-prefixed
// glob negation for exclusions (confirmed by direct testing against a
// throwaway duplicate `.feature` file — the negated entry had zero effect).
// `playwright.config.ts` handles the analogous stale-worktree-duplicate
// hazard (`.ai/tmp/`, `.ai/cezar/worktrees/`) with explicit path
// exclusions precisely because Playwright's own glob engine has the same
// limitation; scoping this config to one literal, non-glob-root path
// sidesteps the problem entirely instead of trying to replicate that
// exclusion list. Generalizing this to other modules (a
// `discoverBddSpecFiles`-style helper, mirroring
// `discoverIntegrationSpecFiles`) is a separate, future step.
module.exports = {
  default: {
    requireModule: [
      // Was `tsx/cjs` — swapped for a hand-written TypeScript-compiler-based
      // require hook (PR #6340 review, M8 follow-up): esbuild's decorator
      // transform (what `tsx` uses) is incompatible with
      // `@mikro-orm/decorators`, see `cucumber-ts-register.cjs`'s own doc
      // comment and the module README's "Verification status" section.
      require.resolve('./cucumber-ts-register.cjs'),
      require.resolve('./cucumber-module-aliases.cjs'),
    ],
    require: [
      'packages/core/src/modules/ledger/__bdd__/step_definitions/**/*.steps.ts',
    ],
    paths: [
      'packages/core/src/modules/ledger/__bdd__/features/**/*.feature',
    ],
    format: ['progress'],
  },
}
