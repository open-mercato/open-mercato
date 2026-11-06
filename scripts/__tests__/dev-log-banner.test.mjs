import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const files = [
  ['monorepo dev and greenfield', new URL('../../apps/mercato/scripts/dev.mjs', import.meta.url)],
  ['standalone', new URL('../../packages/create-app/template/scripts/dev-runtime.mjs', import.meta.url)],
]

for (const [name, file] of files) {
  test(`${name} log hints and raw-log panels use the reference gray background and padding`, () => {
    const source = fs.readFileSync(file, 'utf8')
    const declaration = source.match(/^const LOG_BANNER = .+$/m)?.[0]
    assert.ok(declaration)
    const functions = ['printTerminalBanner', 'printLogToggleHint', 'showBufferedLogs'].map((fn) => {
      const definition = source.match(new RegExp(`function ${fn}\\([^]*?\\n}`))?.[0]
      assert.ok(definition, fn)
      return definition
    })
    const output = []
    vm.runInNewContext(`${declaration}
      const RESET = '\\u001b[0m'; const interactiveLogToggle = true;
      let logsVisible = false; const rawLogBuffer = [];
      ${functions.join('\n')}
      printLogToggleHint(); showBufferedLogs('A diagnostic failure');`, {
      process: { stdout: { columns: 80, write: (chunk) => output.push(chunk) } },
      console: { log: (line) => output.push(line) },
    })
    const banners = output.filter((line) => line.includes('━') || line.includes('Press [d]') || line.includes('RAW DEBUG LOGS') || line.includes('A diagnostic failure'))
    for (const line of banners) assert.ok(line.startsWith('\u001b[48;2;51;55;64m\u001b[97m'), line)
    const plain = output.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ''))
    assert.ok(plain.some((line) => line.startsWith('   Press [d] to show or hide raw logs')))
    assert.ok(plain.some((line) => line.startsWith('   A diagnostic failure')))
    assert.ok(!plain.some((line) => line.trim() === 'DEBUG LOGS'))
  })
}

test('standalone runtime keeps parity with the monorepo runtime', () => {
  assert.equal(fs.readFileSync(files[0][1], 'utf8'), fs.readFileSync(files[1][1], 'utf8'))
})
