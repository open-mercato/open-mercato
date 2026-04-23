import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'))
const packageVersion = packageJson.version

// Inject build-time version into lib/version.ts without touching the source file.
const injectVersion = {
  name: 'inject-version',
  setup(build) {
    build.onLoad({ filter: /lib\/version\.ts$/ }, async () => ({
      contents: `// Build-time generated version
export const APP_VERSION = '${packageVersion}'
export const appVersion = APP_VERSION
`,
      loader: 'ts',
    }))
  },
}

await buildPackage(packageDir, {
  name: 'shared',
  extraPlugins: [injectVersion],
})
