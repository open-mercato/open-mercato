import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'
import { buildVersionSource } from './scripts/versionSource.cjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'))
const packageVersion = packageJson.version

// Inject build-time version into lib/version.ts without touching the source file.
const injectVersion = {
  name: 'inject-version',
  setup(build) {
    build.onLoad({ filter: /lib\/version\.ts$/ }, async () => ({
      contents: buildVersionSource(packageVersion),
      loader: 'ts',
    }))
  },
}

await buildPackage(packageDir, {
  name: 'shared',
  extraPlugins: [injectVersion],
})
