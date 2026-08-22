import fs from 'node:fs'
import path from 'node:path'

const packageRoot = path.resolve(__dirname, '..', '..', '..')
const distDir = path.join(packageRoot, 'dist')

// build.mjs publishes dist/agentic by assembling dist/agentic.staging and swapping it in with two
// renames (#5104). dist/ ships with the package, so a staging tree the build forgot to swap in would
// be published, and a surviving dist/agentic.previous would mean the swap never completed. The same
// invariant is asserted from the Playwright side in __integration__/TC-INT-008.spec.ts, but CI's
// integration scope skips that suite for a diff confined to packages/cli/**, which is exactly the
// diff that can break the build script — so the guard also lives here, in the jest suite the
// affected-package filter always runs for such a diff.
//
// The cli `test` script is plain jest and never builds first, so an unbuilt package skips instead of
// failing a clean local checkout. CI's test job downloads the build-artifacts that prepare's
// `yarn build:packages` produced, so packages/cli/dist is present there and the assertion always
// runs against the tree the package would publish.
const describeBuiltPackage = fs.existsSync(distDir) ? describe : describe.skip

describeBuiltPackage('cli build artifacts', () => {
  it.each(['agentic.staging', 'agentic.previous'])(
    'leaves no dist/%s behind after a completed build',
    (leftover) => {
      expect(fs.existsSync(path.join(distDir, leftover))).toBe(false)
    },
  )
})
