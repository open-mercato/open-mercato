'use strict'

// Jest transformer that sanitizes `import.meta` usages from ESM-only packages
// (primarily @mikro-orm/*) so ts-jest can emit them as CommonJS for tests.
//
// MikroORM v7 is ESM-only and calls `import.meta.resolve(pkg)` at runtime to
// discover optional dependencies. When Jest loads these files as CommonJS,
// parsing fails with "Cannot use 'import.meta' outside a module". This
// transformer replaces `import.meta.resolve(x)` with `require.resolve(x)` and
// any other `import.meta.*` access with safe CommonJS stubs before delegating
// to ts-jest.

const { TsJestTransformer } = require('ts-jest')

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

class SanitizingTsJestTransformer extends TsJestTransformer {
  process(sourceText, sourcePath, options) {
    return super.process(sanitize(sourceText), sourcePath, options)
  }
  processAsync(sourceText, sourcePath, options) {
    return super.processAsync(sanitize(sourceText), sourcePath, options)
  }
  getCacheKey(sourceText, sourcePath, options) {
    const base = super.getCacheKey(sourceText, sourcePath, options)
    return `${base}::im-v1`
  }
}

function createTransformer(config) {
  return new SanitizingTsJestTransformer(config)
}

module.exports = {
  createTransformer,
  // Jest also accepts transformers that export `process`/`processAsync`
  // directly, so expose a default singleton as a fallback.
  process(sourceText, sourcePath, options) {
    if (!module.exports.__instance) {
      module.exports.__instance = new SanitizingTsJestTransformer({
        tsconfig: { jsx: 'react-jsx', module: 'commonjs', target: 'es2022', esModuleInterop: true, allowJs: true },
      })
    }
    return module.exports.__instance.process(sourceText, sourcePath, options)
  },
  processAsync(sourceText, sourcePath, options) {
    if (!module.exports.__instance) {
      module.exports.__instance = new SanitizingTsJestTransformer({
        tsconfig: { jsx: 'react-jsx', module: 'commonjs', target: 'es2022', esModuleInterop: true, allowJs: true },
      })
    }
    return module.exports.__instance.processAsync(sourceText, sourcePath, options)
  },
}
