import { stripVTControlCharacters } from 'node:util'
import { createCliPresentation } from '../lib/engine/cli-presentation'


const settings = { noColor: process.env.NO_COLOR, term: process.env.TERM, lang: process.env.LANG, all: process.env.LC_ALL }
beforeEach(() => { delete process.env.NO_COLOR; process.env.TERM = 'xterm'; process.env.LC_ALL = 'en' })
afterEach(() => {
  for (const [key, value] of Object.entries({ NO_COLOR: settings.noColor, TERM: settings.term, LANG: settings.lang, LC_ALL: settings.all })) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})

test('TTY headings and messages align at the left edge with no blank lines', () => {
  const lines: string[] = []
  const suspended = jest.fn()
  const presenter = createCliPresentation({ mode: 'tty', output: { isTTY: true, columns: 35, write: text => { lines.push(String(text)); return true } }, suspend: suspended })
  const path = '/generated fixture/' + 'long-path-'.repeat(20)
  presenter.title('Database restore')
  presenter.step(1, 3, 'Preflight', 'Trusted source')
  presenter.status('ok', 'Preflight complete')
  presenter.result('Restored', [path])
  presenter.error('Refused', ['Correct the cause'])
  presenter.notice('backups: diagnostic')

  const divider = '─'.repeat(31)
  expect(stripVTControlCharacters(lines.join('')).split('\n')).toEqual([
    'Database restore',
    '── Step 1/3 Preflight',
    'Expected: Trusted source',
    '✅ Preflight complete',
    divider,
    '✅ Restored',
    path,
    divider,
    divider,
    '❌ Refused',
    'Correct the cause',
    divider,
    'backups: diagnostic',
    '',
  ])
  expect(suspended).toHaveBeenCalledTimes(6)
  expect(lines.join('')).toContain('\u001b[34m')
  expect(lines.join('')).toContain('\u001b[32m')
  expect(lines.join('')).not.toContain('\u001b[J')
})

test.each(['NO_COLOR', 'dumb', 'pipe'])('%s fallback has stable ASCII labels and no terminal control', setting => {
  if (setting === 'NO_COLOR') process.env.NO_COLOR = ''
  if (setting === 'dumb') process.env.TERM = 'dumb'
  let text = ''
  const presenter = createCliPresentation({ mode: 'tty', output: { isTTY: setting !== 'pipe', write: chunk => { text += String(chunk); return true } } })
  presenter.title('Backup'); presenter.step(1, 2, 'Preflight'); presenter.status('warn', 'Unencrypted'); presenter.error('Refused', ['Correct the cause'])
  expect(text.startsWith('Backup\n-- Step 1/2 Preflight\n[WARNING] Unencrypted\n')).toBe(true)
  expect(text).not.toContain('\u001b'); expect(text).not.toMatch(/[✅❌❗🔧]/u)
  expect(text).toContain('[WARNING]'); expect(text).toContain('[ERROR]'); expect(text).toContain('-- Step 1/2')
})

test('JSON progress suppresses every human presentation method', () => {
  const write = jest.fn(() => true)
  const presenter = createCliPresentation({ mode: 'json', output: { isTTY: true, write } })
  presenter.title('Backup'); presenter.step(1, 2, 'Preflight'); presenter.status('ok', 'Done'); presenter.result('Done', ['path']); presenter.error('Error', ['resume']); presenter.notice('notice')
  expect(write).not.toHaveBeenCalled()
})

test('none mode suppresses live headings but keeps actionable errors', () => {
  let text = ''
  const presenter = createCliPresentation({ mode: 'none', output: { write: chunk => { text += String(chunk); return true } } })
  presenter.title('Backup'); presenter.step(1, 2, 'Preflight'); presenter.status('working', 'working')
  expect(text).toBe(''); presenter.error('Refused', ['Correct the cause']); expect(text).toContain('[ERROR]')
})

test('untrusted labels cannot add terminal commands or fake status lines', () => {
  let text = ''
  const presenter = createCliPresentation({ mode: 'plain', output: { write: chunk => { text += String(chunk); return true } } })
  presenter.status('info', '\u001b[31mexternal\nFAKE\u001b]8;;https://invalid.test\u0007\u202e')
  expect(text).not.toContain('\u001b'); expect(text).not.toContain('\u202e'); expect(text.trim().split('\n')).toHaveLength(1)
})
