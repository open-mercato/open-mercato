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
