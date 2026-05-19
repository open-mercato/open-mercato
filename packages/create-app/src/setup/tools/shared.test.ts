import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Standalone apps generated from this template declare `"type": "module"` in
// their package.json (see `packages/create-app/template/package.json.template`),
// and `generateShared()` copies these template files into them verbatim. Any
// `.ts` template that references CommonJS-only globals like `__dirname` or
// `__filename` will crash with `ReferenceError` the moment a Node ESM loader
// touches it (e.g. Playwright loading the integration config). These tests
// pin the contract: the templates must be ESM-safe.
const AGENTIC_SHARED_DIR = join(__dirname, '..', '..', '..', 'agentic', 'shared')

const ESM_INCOMPATIBLE_PATTERNS = [
  // bare CommonJS globals; ok only when paired with the polyfill below
  /\b__dirname\b/,
  /\b__filename\b/,
  // bare CJS dynamic require — also undefined under ESM
  /\brequire\s*\(/,
]

const POLYFILL_PATTERNS = {
  __dirname: /path\.dirname\s*\(\s*fileURLToPath\s*\(\s*import\.meta\.url\s*\)\s*\)/,
  __filename: /fileURLToPath\s*\(\s*import\.meta\.url\s*\)/,
  require: /createRequire\s*\(\s*import\.meta\.url\s*\)/,
}

// Tracked .ts templates copied into ESM consumers. When new templates are
// added to `generateShared()`, register them here so this test catches a
// regression at PR time instead of at customer install time.
const TRACKED_TEMPLATES = ['ai/qa/tests/playwright.config.ts']

for (const relativePath of TRACKED_TEMPLATES) {
  test(`agentic/shared template "${relativePath}" is ESM-safe`, () => {
    const fullPath = join(AGENTIC_SHARED_DIR, relativePath)
    const source = readFileSync(fullPath, 'utf8')

    if (ESM_INCOMPATIBLE_PATTERNS[0].test(source)) {
      assert.match(
        source,
        POLYFILL_PATTERNS.__dirname,
        `${relativePath} references __dirname but does not reconstruct it from import.meta.url. ` +
          `Standalone apps generated from this template are "type": "module"; bare __dirname is undefined under ESM.`,
      )
    }
    if (ESM_INCOMPATIBLE_PATTERNS[1].test(source)) {
      assert.match(
        source,
        POLYFILL_PATTERNS.__filename,
        `${relativePath} references __filename but does not reconstruct it from import.meta.url.`,
      )
    }
    if (ESM_INCOMPATIBLE_PATTERNS[2].test(source)) {
      assert.match(
        source,
        POLYFILL_PATTERNS.require,
        `${relativePath} uses require() but does not initialize it via createRequire(import.meta.url).`,
      )
    }
  })
}
