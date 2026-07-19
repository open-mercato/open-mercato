'use strict'

// Native TypeScript 7 does not expose the JavaScript compiler API consumed by
// parser-based tooling. Redirect those runtime imports to the compatibility
// TypeScript package while leaving the native compiler available to typecheck.
const Module = require('module')
const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function (request, ...rest) {
  if (request === 'typescript') request = 'typescript-js'
  return originalResolveFilename.call(this, request, ...rest)
}
