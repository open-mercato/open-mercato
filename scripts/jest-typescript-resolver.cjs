'use strict'

// TEMPORARY (TypeScript 7 migration): redirect test-code `import ts from
// 'typescript'` to the JS-based TypeScript installed under the `typescript-js`
// npm alias. Native TS 7 is a Go compiler and no longer ships the JavaScript
// compiler API (`ts.createSourceFile`, `ts.ScriptTarget`, …) that structural
// tests rely on. Test-code requires are resolved by jest's own module runtime,
// which the ts-jest transformer's `Module._resolveFilename` patch does not
// cover — hence this jest `resolver`. Remove once tests no longer need the
// classic TS API on native TS 7.
module.exports = (request, options) => {
  if (request === 'typescript') {
    return options.defaultResolver('typescript-js', options)
  }
  return options.defaultResolver(request, options)
}
