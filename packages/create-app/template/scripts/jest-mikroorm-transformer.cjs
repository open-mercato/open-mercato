'use strict'

// Jest transformer that sanitizes `import.meta` usages from ESM-only packages
// (primarily @mikro-orm/*) so ts-jest can emit them as CommonJS for tests.
//
// MikroORM v7 is ESM-only and calls `import.meta.resolve(pkg)` at runtime to
// discover optional dependencies. Jest loads these files as CommonJS, so
// parsing fails with "Cannot use 'import.meta' outside a module" — and because
// `@open-mercato/shared/lib/commands` pulls MikroORM in transitively, that
// failure hits every command, entity, or data-engine test an app writes. This
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
    return `${super.getCacheKey(sourceText, sourcePath, options)}::im-v1`
  }
}

module.exports = {
  createTransformer(config) {
    return new SanitizingTsJestTransformer(config)
  },
  sanitize,
}
