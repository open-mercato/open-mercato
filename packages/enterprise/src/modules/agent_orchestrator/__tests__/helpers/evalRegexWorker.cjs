const fs = require('node:fs')
const Module = require('node:module')

const paths = JSON.parse(process.argv[2])
const compiler = require(paths.compiler)
const resolveFilename = Module._resolveFilename
const aliases = {
  zod: paths.zod,
  re2js: paths.re2js,
  '@open-mercato/shared/lib/regex/linear': paths.linear,
}

Module._resolveFilename = function (request, parent, ...rest) {
  return aliases[request] ?? resolveFilename.call(this, request, parent, ...rest)
}

require.extensions['.ts'] = (loadedModule, filename) => {
  const source = compiler.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: compiler.ModuleKind.CommonJS,
      target: compiler.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  loadedModule._compile(source, filename)
}

const input = 'a'.repeat(10_000)
let matched
if (paths.matcher === 'regex') {
  const { regex } = require(paths.text)
  matched = regex.score({ output: input }, null, {
    pattern: '^(.|.)*\\x00$',
    caseInsensitive: false,
  }).passed
} else if (paths.matcher === 'glob') {
  const { matchesNameOrPattern } = require(paths.shared)
  matched = matchesNameOrPattern(input, undefined, `${'*a'.repeat(100)}b`)
} else {
  throw new Error('[internal] unknown regex regression scenario')
}

if (matched !== false) throw new Error('[internal] unexpected adversarial match verdict')
process.stdout.write('false')
