import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript-js'
import { build } from 'esbuild'

import { atomicWriteFileSync, createAtomicWritePlugin, rewriteRelativeImports } from '../lib/add-js-extension.mjs'

test('atomicWriteFileSync preserves mtime for byte-identical output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-stable-'))
  try {
    const filePath = path.join(root, 'dist', 'index.js')
    assert.equal(atomicWriteFileSync(filePath, 'export const value = 1\n'), true)

    const stableTime = new Date('2020-01-01T00:00:00Z')
    fs.utimesSync(filePath, stableTime, stableTime)

    assert.equal(atomicWriteFileSync(filePath, 'export const value = 1\n'), false)
    assert.equal(fs.statSync(filePath).mtimeMs, stableTime.getTime())

    assert.equal(atomicWriteFileSync(filePath, 'export const value = 2\n'), true)
    assert.ok(fs.statSync(filePath).mtimeMs > stableTime.getTime())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rewrites only actual module specifiers and leaves quoted examples, templates, regexes and comments intact', () => {
  const snippet = `import { Thing } from './thing'\nconst load = () => import('#generated/items')\nimport './setup';`
  const fixtures = [
    `export const example = ${JSON.stringify(snippet)};`,
    "const template = `import './template'; export { x } from './other'`;",
    "const pattern = /from ['\"]\\.\\/fake['\"]/;",
    "// import './comment';",
    "/* export { value } from './block-comment' */",
    "const object = { from: './property', import(value) { return value } }; object.import('./method');",
  ]
  const source = fixtures.join('\n') + "\nimport { real } from './real';\n"
  const rewritten = rewriteRelativeImports(source, '/build')
  assert.equal(rewritten, fixtures.join('\n') + '\nimport { real } from "./real.js";\n')
  assert.equal(ts.createSourceFile('output.js', rewritten, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0)
})

test('handles import declarations, reexports, side effects and nested dynamic imports without discarding formatting or attributes', () => {
  const source = [
    "import value from /* keep */ './value'",
    "export { value } from './named';",
    "export * from './all';",
    "export * as group from './group';",
    "import './setup'",
    "async function load() { return import(/* lazy */ './lazy', { with: { type: 'json' } }); }",
    "const variable = './variable'; const unresolved = import(variable);",
    'const template = import(`./template/${variable}`);',
    "import packageName from '@open-mercato/shared';",
  ].join('\n')
  const rewritten = rewriteRelativeImports(source, '/build')
  for (const name of ['value', 'named', 'all', 'group', 'setup', 'lazy']) assert.ok(rewritten.includes(`"./${name}.js"`))
  assert.ok(rewritten.includes('from /* keep */'))
  assert.ok(rewritten.includes('import(/* lazy */ "./lazy.js", { with: { type: \'json\' } })'))
  assert.ok(rewritten.includes('import(variable)'))
  assert.ok(rewritten.includes('import(`./template/${variable}`)'))
  assert.ok(rewritten.includes("from '@open-mercato/shared'"))
  assert.equal(rewriteRelativeImports(rewritten, '/build'), rewritten)
})

test('resolves generated imports only in syntax nodes and preserves unresolved aliases', () => {
  const calls = []
  const source = [
    "import { registry } from '#generated/registry';",
    "export { entities } from '#generated/entities';",
    "const load = () => import('#generated/lazy');",
    "import '#generated/side-effect';",
    "import { unknown } from '#generated/unknown';",
    `const example = ${JSON.stringify("import { copy } from '#generated/example'")};`,
  ].join('\n')
  const rewritten = rewriteRelativeImports(source, '/build', { resolveGeneratedImport: (name, directory) => { calls.push([name, directory]); return name === 'unknown' ? null : `../generated/${name}.js` } })
  assert.deepEqual(calls.map(([name]) => name), ['registry', 'entities', 'lazy', 'side-effect', 'unknown'])
  assert.ok(calls.every(([, directory]) => directory === '/build'))
  assert.ok(rewritten.includes('from "../generated/registry.js"'))
  assert.ok(rewritten.includes('import("../generated/lazy.js")'))
  assert.ok(rewritten.includes("from '#generated/unknown'"))
  assert.ok(rewritten.includes(JSON.stringify("import { copy } from '#generated/example'")))
})

test('preserves explicit assets and executable extensions including query strings with custom skip options', () => {
  const paths = ['./photo.png', './logo.svg', './photo.webp', './font.woff2', './style.css', './module.mjs', './common.cjs', './data.json', './typed.ts', './logo.svg?url', './photo.png#version']
  const source = paths.map((specifier, index) => `import asset${index} from '${specifier}';`).join('\n')
  assert.equal(rewriteRelativeImports(source, '/build', { skipExtensions: ['.js', '.json', '.ts'] }), source)
  assert.equal(rewriteRelativeImports("import value from './module?raw'", '/build'), 'import value from "./module.js?raw"')
})

test('resolves directory imports against planned outputs and keeps dotted module basenames', () => {
  const rewritten = rewriteRelativeImports("import { value } from './shared'; export { handler } from './page.meta';", '/build', { knownOutputPaths: new Set(['/build/shared/index.js', '/build/page.meta.js']) })
  assert.equal(rewritten, 'import { value } from "./shared/index.js"; export { handler } from "./page.meta.js";')
})

test('escapes rewritten specifiers and respects the existing template placeholder option', () => {
  assert.equal(rewriteRelativeImports("import value from './quo\\'te';", '/build'), 'import value from "./quo\'te.js";')
  const source = "import value from './${moduleName}';"
  assert.equal(rewriteRelativeImports(source, '/build', { skipTemplateLiterals: true }), source)
})

test('atomic build plugin emits valid generated examples and preserves asset imports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-source-example-'))
  try {
    const snippet = "import photo from '../assets/photo.png'\nimport { Input } from './input'\nexport const create = () => import('#generated/items')"
    const source = `import photo from './photo.png'; import { value } from './value'; export const example = ${JSON.stringify(snippet)}; export { photo, value };`
    const result = await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, outfile: path.join(root, 'output.js'), format: 'esm', bundle: false, plugins: [createAtomicWritePlugin()] })
    assert.equal(result.errors.length, 0)
    const output = fs.readFileSync(path.join(root, 'output.js'), 'utf8')
    assert.ok(output.includes('from "./photo.png"'))
    assert.ok(output.includes('from "./value.js"'))
    assert.ok(output.includes(JSON.stringify(snippet)))
    assert.equal(ts.createSourceFile('output.js', output, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
