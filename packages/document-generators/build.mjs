import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const fontsDir = join(packageDir, 'src/modules/document_generators/templates/shared/fonts')

async function generateFontModules() {
  const fontFiles = await glob('*.ttf', { cwd: fontsDir, absolute: true })

  for (const file of fontFiles) {
    const name = basename(file, '.ttf')
    const base64 = readFileSync(file).toString('base64')
    const output = `const src = "data:font/truetype;base64,${base64}"\nexport default src\n`
    writeFileSync(join(fontsDir, `${name}.generated.ts`), output)
  }

  console.log(`[build:document-generators] generated ${fontFiles.length} font modules`)
}

await buildPackage(packageDir, {
  name: 'document-generators',
  copyJson: true,
  beforeBuild: generateFontModules,
})
