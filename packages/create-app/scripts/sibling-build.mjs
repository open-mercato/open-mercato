// The package build reads the module-facts generators from @open-mercato/cli's compiled output, so
// on a tree where that sibling has not been built yet the build dies with a bare
// ERR_MODULE_NOT_FOUND. Since the package `test` script now builds before the runner starts, that
// crash lands in front of requirePackageBuild() and swallows the very "run the build first"
// sentence this package's test plumbing exists to print (#5059, #5052). `turbo.json` declares the
// dependency for the `build` and `test` tasks; a direct `node build.mjs` invocation has no such
// graph, so the same message is produced here.
export function describeMissingSiblingBuild(error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') return null
  return new Error(
    '[internal] create-mercato-app cannot build: a sibling package it imports at build time is not '
    + 'compiled yet. Run `yarn build:packages` from the monorepo root first, then rerun this build.',
    { cause: error },
  )
}
