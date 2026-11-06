import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const files = [
  ['monorepo dev and greenfield', new URL('../../apps/mercato/scripts/dev.mjs', import.meta.url)],
  ['standalone', new URL('../../packages/create-app/template/scripts/dev-runtime.mjs', import.meta.url)],
]

for (const [name, file] of files) {
  test(`${name} log hints are compact emoji lines without backgrounds or borders`, () => {
    const source = fs.readFileSync(file, 'utf8')
    const functions = ['printLogToggleHint', 'showBufferedLogs'].map((fn) => {
      const definition = source.match(new RegExp(`function ${fn}\\([^]*?\\n}`))?.[0]
      assert.ok(definition, fn)
      return definition
    })
    const output = []
    vm.runInNewContext(`      const RESET = '\\u001b[0m'; const interactiveLogToggle = true;
      let logsVisible = false; const rawLogBuffer = [];
      ${functions.join('\n')}
      printLogToggleHint(); showBufferedLogs('A diagnostic failure');`, {
      process: { stdout: { columns: 80, write: (chunk) => output.push(chunk) } },
      console: { log: (line) => output.push(line) },
    })
    const text = output.join('\n')
    assert.match(text, /^📋 Press \[d\] to show or hide raw logs/m)
    assert.match(text, /   📖 A diagnostic failure · press \[d\] to hide/)
    assert.doesNotMatch(text, /\u001b\[(?:4[0-9]|10[0-7])|━|DEBUG LOGS/)
  })
}

test('standalone runtime keeps parity with the monorepo runtime', () => {
  assert.equal(fs.readFileSync(files[0][1], 'utf8'), fs.readFileSync(files[1][1], 'utf8'))
})

test('dev output avoids variation-selector emoji whose width differs between terminals', () => {
  const directories = [new URL('../', import.meta.url), new URL('../../apps/mercato/scripts/', import.meta.url)]
  const offenders = directories.flatMap((directory) => fs.readdirSync(directory)
    .filter((name) => name.startsWith('dev') && name.endsWith('.mjs'))
    .flatMap((name) => fs.readFileSync(new URL(name, directory), 'utf8').split('\n')
      .filter((line) => line.includes('️') && !line.includes("startsWith('⚠️ [encryption]"))
      .map((line) => `${name}: ${line.trim()}`)))
  assert.deepEqual(offenders, [])
})
