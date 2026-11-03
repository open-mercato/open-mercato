/**
 * The module's own architecture rules, in a form something can check.
 *
 * Every rule below is a sentence `src/modules/marketing_automation/AGENTS.md` already states. Until this file
 * existed they were prose: true because everybody had read them, and silently untrue the first time somebody
 * had not. The point of writing them here is that a violation now fails rather than waits to be noticed in
 * review.
 *
 * Run from the REPOSITORY ROOT, and pass a glob rather than a directory:
 *
 *   npx dependency-cruiser --config packages/marketing-automation/.dependency-cruiser.cjs \
 *     "packages/marketing-automation/src/**\/*.ts"
 *
 * A directory argument collects zero modules here and reports "no violations found", which is the most
 * dangerous output a gate can produce — hence the glob, and hence this note.
 *
 * The tool is deliberately NOT a dependency of this package — it runs through `npx`, so these rules travel with
 * the module while the toolchain stays out of `package.json`. Wire it into whatever pipeline you prefer, or run
 * it by hand; the rules are the contribution, the runner is not.
 */
module.exports = {
  forbidden: [
    {
      name: 'engine-stays-pure',
      severity: 'error',
      comment:
        "`lib/engine/` is the sequencing logic, and it is the part most worth testing. It stays testable only " +
        'while it needs no database, no container and no DOM to run — AGENTS.md: "Keep lib/engine/ pure — no ' +
        'React, no ORM, no container, no reportError."',
      from: {
        path: '^packages/marketing-automation/src/modules/marketing_automation/lib/engine/',
        pathNot: '__tests__',
      },
      to: {
        dependencyTypes: ['npm'],
        path: '^(react|react-dom|next|@mikro-orm|awilix)',
      },
    },
    {
      name: 'engine-takes-no-entities',
      severity: 'error',
      comment:
        'The engine works over plain shapes — a run state, a subject document, a step — never over ORM entities. ' +
        'An entity here would drag a database into every unit test that touches sequencing.',
      from: {
        path: '^packages/marketing-automation/src/modules/marketing_automation/lib/engine/',
        pathNot: '__tests__',
      },
      to: { path: '^packages/marketing-automation/src/modules/marketing_automation/data/entities' },
    },
    {
      name: 'no-circular-imports',
      severity: 'error',
      comment:
        'A cycle is a refactor waiting to become a runtime failure. Two existed when this rule was written, both ' +
        'through a type that three files shared; moving it to `lib/scope.ts` removed them. Type-only cycles are ' +
        'erased at runtime, which is exactly why they survive unnoticed until somebody needs a value across the ' +
        'same edge.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-reach-into-enterprise',
      severity: 'error',
      comment:
        'This module is open source. `packages/enterprise` is commercial and cannot accept external ' +
        'contributions, so a dependency on it would make this module unmergeable as well as unbuildable for ' +
        'anybody without that package.',
      from: { path: '^packages/marketing-automation/src' },
      to: { path: '^packages/enterprise' },
    },
    {
      name: 'no-orphan-modules',
      severity: 'warn',
      comment:
        'A source file nothing imports is either dead or a convention file the generator discovers. Warned rather ' +
        'than failed, because the second kind is legitimate and common here.',
      from: { orphan: true, pathNot: '(__tests__|__integration__|\\.d\\.ts$|migrations/)' },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // How an import specifier is resolved. Without it every `./x.js` in this ESM-style TypeScript resolves to
    // nothing and the graph comes out empty.
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'] },
    tsConfig: { fileName: 'packages/marketing-automation/tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '(__tests__|__integration__|/dist/)' },
  },
}
