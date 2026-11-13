import { mkdtemp, rm, writeFile, readFile, link, open, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { RotationArtifactStore } from '../store'

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises')
  return { ...actual, link: jest.fn(actual.link), open: jest.fn(actual.open) }
})
const real = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
const linkMock = jest.mocked(link); const openMock = jest.mocked(open)
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'rotation-store-links-')); jest.clearAllMocks(); linkMock.mockImplementation(real.link); openMock.mockImplementation(real.open) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const address = (index: number) => `intent-${createHash('sha256').update(String(index)).digest('hex')}`
async function fixture() {
  const root = join(directory, 'artifacts')
  const store = new RotationArtifactStore(root, { seal: async bytes => bytes, open: async bytes => bytes })
  await store.initialize(); await store.write('header', Buffer.from('synthetic sealed intent page'))
  jest.clearAllMocks()
  return { root, store }
}

test('bounds hardlink concurrency and fsyncs the directory only after every alias completes', async () => {
  const { root, store } = await fixture()
  let active = 0; let maximum = 0; let syncs = 0
  linkMock.mockImplementation(async (source, destination) => {
    active++; maximum = Math.max(maximum, active)
    try { await new Promise(resolve => setImmediate(resolve)); await real.link(source, destination) }
    finally { active-- }
  })
  openMock.mockImplementation(async (...args) => {
    const handle = await real.open(...args)
    if (args[0] === root) {
      const sync = handle.sync.bind(handle)
      jest.spyOn(handle, 'sync').mockImplementation(async () => { expect(active).toBe(0); syncs++; await sync() })
    }
    return handle
  })
  const aliases = Array.from({ length: 17 }, (_, index) => address(index))
  await store.linkNames('header', aliases)
  expect(maximum).toBeGreaterThan(1); expect(maximum).toBeLessThanOrEqual(8)
  expect(active).toBe(0); expect(syncs).toBe(1)
  for (const alias of aliases) expect(await store.fileIdentity(alias)).toBe(await store.fileIdentity('header'))
})

test('a collision joins every started link before rejecting and never replaces an original address', async () => {
  const { root, store } = await fixture()
  const aliases = Array.from({ length: 17 }, (_, index) => address(index))
  await writeFile(join(root, `${aliases[0]}.age`), 'original', { mode: 0o600 })
  let active = 0
  linkMock.mockImplementation(async (source, destination) => {
    active++
    try { await new Promise(resolve => setTimeout(resolve, 5)); await real.link(source, destination) }
    finally { active-- }
  })
  await expect(store.linkNames('header', aliases)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(active).toBe(0); expect(linkMock).toHaveBeenCalledTimes(8)
  expect(openMock).not.toHaveBeenCalled()
  expect(await readFile(join(root, `${aliases[0]}.age`), 'utf8')).toBe('original')
  await expect(access(join(root, `${aliases[8]}.age`))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('invalid or excessive bounded addresses refuse before starting links', async () => {
  const { store } = await fixture()
  await expect(store.linkNames('header', [...Array.from({ length: 8 }, (_, index) => address(index)), '../invalid'])).rejects.toThrow('ARTIFACT_INVALID')
  await expect(store.linkNames('header', Array.from({ length: 501 }, (_, index) => address(index)))).rejects.toThrow('ARTIFACT_LIMIT')
  expect(linkMock).not.toHaveBeenCalled()
})
