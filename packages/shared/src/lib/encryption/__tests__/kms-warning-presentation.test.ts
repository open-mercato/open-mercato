import { runWithKmsWarningWriter, writeKmsWarning } from '../kms-warning-presentation'
import { createKmsService } from '../kms'
import { registerLoggerExtension, resetLogLevelCache, type LoggerExtensionRecord } from '../../logger'

jest.mock('../../logger/transport', () => {
  const local = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => local }
  return { selectTransport: () => local, __local: local }
})
const local = (jest.requireMock('../../logger/transport') as { __local: { warn: jest.Mock } }).__local
const originalEnv = { ...process.env }
let tty: PropertyDescriptor | undefined
beforeEach(() => { tty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY') })
afterEach(() => {
  process.env = { ...originalEnv }; resetLogLevelCache()
  if (tty) Object.defineProperty(process.stderr, 'isTTY', tty)
  else delete (process.stderr as unknown as { isTTY?: boolean }).isTTY
  jest.restoreAllMocks()
})

test('concurrent and nested writers retain only their own asynchronous warning context', async () => {
  const first: string[] = [], second: string[] = [], nested: string[] = []
  const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true)
  await Promise.all([
    runWithKmsWarningWriter(lines => { first.push(...lines) }, async () => {
      await Promise.resolve(); writeKmsWarning(['first'])
      await runWithKmsWarningWriter(lines => { nested.push(...lines) }, async () => { await Promise.resolve(); writeKmsWarning(['nested']) })
      writeKmsWarning(['first-again'])
    }),
    runWithKmsWarningWriter(lines => { second.push(...lines) }, async () => { await Promise.resolve(); writeKmsWarning(['second']) }),
  ])
  expect(first).toEqual(['first', 'first-again']); expect(second).toEqual(['second']); expect(nested).toEqual(['nested'])
  expect(stderr).not.toHaveBeenCalled()
  delete process.env.NO_COLOR; process.env.TERM = 'dumb'
  writeKmsWarning(['outside'])
  expect(stderr).toHaveBeenCalledWith('outside\n')
})

test.each(['pipe', 'tty', 'no-color-empty', 'dumb'])('unscoped %s presentation retains warning with appropriate ANSI capability', mode => {
  delete process.env.NO_COLOR; process.env.TERM = 'xterm'
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: mode !== 'pipe' })
  if (mode === 'no-color-empty') process.env.NO_COLOR = ''
  if (mode === 'dumb') process.env.TERM = 'dumb'
  const output = jest.spyOn(process.stderr, 'write').mockReturnValue(true)
  writeKmsWarning(['Keep recovery custody', 'Source: EXPLICIT_SETTING'])
  const text = String(output.mock.calls[0][0])
  expect(text).toContain('Keep recovery custody'); expect(text).toContain('Source: EXPLICIT_SETTING')
  expect(text.includes('\x1b')).toBe(mode === 'tty')
})

test('an inactive or failed scoped writer retains the normal visible warning', () => {
  process.env.NO_COLOR = ''
  const output = jest.spyOn(process.stderr, 'write').mockReturnValue(true)
  runWithKmsWarningWriter(() => false, () => writeKmsWarning(['inactive']))
  runWithKmsWarningWriter(() => { throw new Error('writer failed') }, () => writeKmsWarning(['failed']))
  expect(output.mock.calls.map(call => call[0])).toEqual(['inactive\n', 'failed\n'])
})

test('scoped KMS banner preserves the canonical local warning and remote logger record without key material', () => {
  process.env.NODE_ENV = 'production'; process.env.OM_LOG_LEVEL = 'warn'; resetLogLevelCache(); process.env.TENANT_DATA_ENCRYPTION = 'yes'
  process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'private-test-root-not-for-output'
  delete process.env.VAULT_ADDR; delete process.env.VAULT_TOKEN
  const records: LoggerExtensionRecord[] = [], warnings: string[] = []
  const dispose = registerLoggerExtension({ emit: record => { records.push(record) } })
  try {
    runWithKmsWarningWriter(lines => { warnings.push(...lines) }, () => createKmsService())
    expect(warnings).toHaveLength(3)
    expect(warnings.join('\n')).toContain('Without it, encrypted tenant data cannot be recovered after restart.')
    expect(local.warn).toHaveBeenCalledWith('Using derived tenant encryption keys (Vault unavailable / no DEK)', { fallbackSource: 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY' })
    expect(records).toContainEqual(expect.objectContaining({ namespace: 'shared', level: 'warn', message: 'Using derived tenant encryption keys (Vault unavailable / no DEK)', fields: { component: 'kms', fallbackSource: 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY' } }))
    expect(JSON.stringify({ records, warnings })).not.toContain('private-test-root-not-for-output')
  } finally { dispose() }
})
