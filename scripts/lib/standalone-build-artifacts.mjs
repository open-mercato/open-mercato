import fs from 'node:fs'
import path from 'node:path'

/**
 * Artifacts a scaffolded app's production build must emit, relative to its dist directory
 * (`.mercato/next`, per the template's `next.config.ts` `distDir`).
 *
 * `_global-error.html` is a Next-internal detail on purpose. Issue #2445 shipped a template
 * whose production build aborted while prerendering `/_global-error`, and four validation runs
 * dismissed it as "pre-existing" because nothing ever production-built a scaffolded app. The
 * route is synthetic — Next hardcodes its page to the builtin `app-error.js` — so a Next upgrade
 * that renames it, moves its output, or stops prerendering it will fail this check for a reason
 * unrelated to the scaffolded app. The label says so, so the next person does not have to
 * re-derive it. See `.ai/lessons/global-error-prerender-failures-are-next-version-issues.md`.
 */
export const STANDALONE_PRODUCTION_BUILD_ARTIFACTS = [
  {
    relativePath: ['BUILD_ID'],
    label: 'Standalone production build produced a build id',
  },
  {
    relativePath: ['server', 'app', '_global-error.html'],
    label: 'Standalone production build prerendered /_global-error (Next-internal route; re-verify on any next upgrade)',
  },
]

/**
 * Assert that a scaffolded app's production build wrote every expected artifact.
 *
 * Throws on the first missing artifact so the harness fails fast with the label that explains
 * what the artifact proves. `exists` is injectable so the guard itself is unit-testable without
 * scaffolding and building a real app.
 */
export function assertProductionBuildArtifacts(appDir, options = {}) {
  const exists = options.exists ?? ((filePath) => fs.existsSync(filePath))
  const onSuccess = options.onSuccess ?? (() => {})
  const distDir = path.join(appDir, '.mercato', 'next')

  for (const artifact of STANDALONE_PRODUCTION_BUILD_ARTIFACTS) {
    const filePath = path.join(distDir, ...artifact.relativePath)
    if (!exists(filePath)) {
      throw new Error(`${artifact.label} is missing: ${filePath}`)
    }
    onSuccess(artifact.label)
  }
}
