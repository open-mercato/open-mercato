import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

await buildPackage(packageDir, {
  name: 'cache-provider-ignite',
  entryPoints: 'src/**/*.ts',
  extraIgnore: ['src/**/*.d.ts'],
})

execFileSync(process.execPath, [join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'), '-p', 'tsconfig.build.json', '--emitDeclarationOnly'], {
  cwd: packageDir,
  stdio: 'inherit',
})
