import { copyFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../../../../../scripts/build-package.mjs'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const sharedRoot = resolve(cliRoot, '../shared')
const buildRoot = process.argv[2]
const sharedPackage = join(buildRoot, 'node_modules/@open-mercato/shared')

await buildPackage(sharedRoot, {
  outdir: relative(sharedRoot, join(sharedPackage, 'dist')),
})
copyFileSync(join(sharedRoot, 'package.json'), join(sharedPackage, 'package.json'))

await buildPackage(cliRoot, {
  entryPoints: 'src/**/*.ts',
  outdir: relative(cliRoot, buildRoot),
  copyJson: true,
  rewriteOptions: {
    skipExtensions: ['.js', '.json', '.ts'],
    skipTemplateLiterals: true,
  },
})
