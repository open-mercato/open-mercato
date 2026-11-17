import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createFileToolFixtureStore } from '../lib/eval/toolFixtures'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseEvalCliModelFixtureFlags, withCaseModelFixtures } from '../lib/eval/modelFixtures'

const ref = { agentId: 'synthetic.agent', caseKey: 'synthetic-case', trialIndex: 0, fixturePath: null }
let directory: string
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-model-fixtures-')) })
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

it('writes private atomic files and verifies case and trial identity', async () => {
  await expect(withCaseModelFixtures({ mode: 'record', directory }, ref, async () => 'done')).resolves.toBe('done')
  const file = path.join(directory, ref.agentId, `${ref.caseKey}.0.model.json`)
  expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)])
  await expect(withCaseModelFixtures({ mode: 'replay', directory }, ref, async () => 'replayed')).resolves.toBe('replayed')
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'))
  fixture.caseKey = 'another-case'
  fs.writeFileSync(file, JSON.stringify(fixture))
  await expect(withCaseModelFixtures({ mode: 'replay', directory }, ref, async () => 'bad')).rejects.toThrow('model_fixture_identity_mismatch')
  await expect(withCaseModelFixtures({ mode: 'replay', directory }, { ...ref, trialIndex: 1 }, async () => 'bad')).rejects.toThrow('model_fixture_invalid_or_missing')
})

it('rejects path traversal, symlinks and oversized files before invoking the run', async () => {
  const run = jest.fn(async () => undefined)
  await expect(withCaseModelFixtures({ mode: 'replay', evalSetDir: directory }, { ...ref, fixturePath: '../escape.json' }, run)).rejects.toThrow('model_fixture_path_invalid')
  await withCaseModelFixtures({ mode: 'record', directory }, ref, async () => undefined)
  const file = path.join(directory, ref.agentId, `${ref.caseKey}.0.model.json`)
  const link = path.join(directory, 'link.json')
  fs.symlinkSync(file, link)
  await expect(withCaseModelFixtures({ mode: 'replay', evalSetDir: directory }, { ...ref, fixturePath: 'link.json' }, run)).rejects.toThrow('model_fixture_invalid_or_missing')
  fs.writeFileSync(file, Buffer.alloc(5 * 1024 * 1024 + 1))
  await expect(withCaseModelFixtures({ mode: 'replay', directory }, ref, run)).rejects.toThrow('model_fixture_invalid')
  expect(run).not.toHaveBeenCalled()
})

it('keeps tool-only replay live and makes offline selection explicit', () => {
  expect(parseEvalCliModelFixtureFlags({ replay: directory })).toEqual({ ok: true })
  expect(parseEvalCliModelFixtureFlags({ replay: directory, offline: 'true' })).toEqual({ ok: true, options: { mode: 'replay', directory, evalSetDir: undefined } })
  expect(parseEvalCliModelFixtureFlags({ record: directory })).toEqual({ ok: true, options: { mode: 'record', directory } })
  for (const flags of [{ offline: 'yes' }, { offline: 'true' }, { offline: 'true', record: directory }, { offline: 'true', replay: directory, onFixtureMiss: 'live' }]) {
    expect(parseEvalCliModelFixtureFlags(flags).ok).toBe(false)
  }
  expect(parseEvalCliModelFixtureFlags({ evalSetDir: directory, casesFile: { cases: [{ fixtures: { model: 'case.model.json' } }] } })).toEqual({ ok: true, options: { mode: 'replay', directory: undefined, evalSetDir: directory } })
})

it('keeps tool recordings for separate offline trials separate', async () => {
  const store = createFileToolFixtureStore({ recordDir: directory, replayDir: directory, perTrial: true })
  const fixture = { toolName: 'lookup', argsKey: 'synthetic', args: {}, output: { trial: 0 }, occurrence: 0 }
  await store.save(ref, [fixture])
  await store.save({ ...ref, trialIndex: 1 }, [{ ...fixture, output: { trial: 1 } }])
  expect(await store.load(ref)).toMatchObject({ ok: true, fixtures: [{ output: { trial: 0 } }] })
  expect(await store.load({ ...ref, trialIndex: 1 })).toMatchObject({ ok: true, fixtures: [{ output: { trial: 1 } }] })
})

const unixTest = process.platform === 'win32' ? it.skip : it
unixTest('rejects an in-directory FIFO without blocking the event loop', () => {
  const fifo = path.join(directory, 'fixture.fifo')
  const made = spawnSync('mkfifo', [fifo], { timeout: 2000 })
  expect(made.status).toBe(0)
  const source = pathToFileURL(path.resolve(__dirname, '../lib/eval/fixtureFileRead.ts')).href
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    const { readRegularFixtureFile } = await import(process.argv[1]);
    try {
      readRegularFixtureFile(process.argv[2] + '/fixture.fifo', 1024);
      process.exitCode = 1;
    } catch (error) {
      if (!error.message.includes('model_fixture_invalid')) throw error;
    }
  `, source, directory], { timeout: 5000, encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
})
