'use strict'

// Custom `.ts`/`.tsx` require-hook for cucumber-js (PR #6340 review, M8
// follow-up). Replaces the previous `tsx/cjs` requireModule entry, which
// the README documented as producing decorator output incompatible with
// `@mikro-orm/decorators` (`TypeError: Cannot read properties of
// undefined (reading 'constructor')` inside
// `@mikro-orm/decorators/legacy/PrimaryKey.js`) — esbuild's decorator
// transform (what `tsx` uses) does not match what MikroORM's legacy
// decorators expect at runtime.
//
// The ledger module's own Jest suite loads these same command files (and their
// decorator-based `data/entities.ts`) successfully via `ts-jest`, which
// transforms with the real TypeScript compiler, not esbuild — see
// `scripts/jest-mikroorm-transformer.cjs`. This hook reproduces that same
// approach for cucumber-js directly (rather than pulling in `ts-node`,
// whose own compiler-resolution and caching layers would need the same
// redirect below plus more moving parts than this narrow use case needs):
// per-file `ts.transpileModule`, real TypeScript output, same
// `import.meta` sanitization and `typescript` -> `typescript-js` redirect
// as the Jest transformer, so decorator metadata emission matches exactly
// what that Jest suite already proved works against these same entities.
const Module = require('module')
const fs = require('fs')

// TypeScript 7 is a native (Go) compiler with no JS-based `transpileModule`
// API (`require('typescript')` resolves to a stub exporting only
// `version`). Redirect to the JS-based TypeScript installed under the
// `typescript-js` npm alias, exactly like `jest-mikroorm-transformer.cjs`
// does for ts-jest.
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  if (request === 'typescript') request = 'typescript-js'
  return originalResolveFilename.call(this, request, ...rest)
}

const ts = require('typescript-js')

const IMPORT_META_RESOLVE_RE = /import\.meta\.resolve\(/g
const IMPORT_META_URL_RE = /import\.meta\.url/g
const IMPORT_META_DIRNAME_RE = /import\.meta\.dirname/g
const IMPORT_META_FILENAME_RE = /import\.meta\.filename/g
const BARE_IMPORT_META_RE = /import\.meta\b/g

function sanitize(code) {
  if (typeof code !== 'string' || !code.includes('import.meta')) return code
  return code
    .replace(IMPORT_META_RESOLVE_RE, 'require.resolve(')
    .replace(IMPORT_META_URL_RE, '(typeof __filename !== "undefined" ? require("url").pathToFileURL(__filename).href : "")')
    .replace(IMPORT_META_DIRNAME_RE, '(typeof __dirname !== "undefined" ? __dirname : "")')
    .replace(IMPORT_META_FILENAME_RE, '(typeof __filename !== "undefined" ? __filename : "")')
    .replace(BARE_IMPORT_META_RE, '({})')
}

// Mirrors tsconfig.base.json's compilerOptions (module/target swapped to
// what a `require()`-based CJS runtime needs; jsx/decorator settings kept
// identical since those are what the entity decorators depend on).
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  esModuleInterop: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
  isolatedModules: true,
  useDefineForClassFields: false,
  resolveJsonModule: true,
}

function compile(filename) {
  const source = sanitize(fs.readFileSync(filename, 'utf8'))
  const { outputText } = ts.transpileModule(source, {
    compilerOptions,
    fileName: filename,
    reportDiagnostics: false,
  })
  return outputText
}

require.extensions['.ts'] = function requireTs(mod, filename) {
  mod._compile(compile(filename), filename)
}
require.extensions['.tsx'] = require.extensions['.ts']
