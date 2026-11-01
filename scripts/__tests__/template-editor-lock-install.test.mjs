import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { create } from 'tar'
import { parse, stringify } from 'yaml'
import { buildTemplateEditorLock } from '../sync-template-editor-lock.mjs'

const execute = promisify(execFile)
const packageManager = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).packageManager

test('a reviewed editor seed survives fresh resolution without exempting newer or unrelated releases', { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'template-editor-registry-'))
  let fresh = false
  let registryUrl
  const packages = new Map()
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, registryUrl).pathname).slice(1)
    const tarball = packages.get(pathname)
    if (tarball) {
      response.end(tarball)
      return
    }
    const versions = pathname === '@tiptap/core' ? ['3.32.2', '3.32.3'] : pathname === 'editor-lock-unrelated' ? ['1.0.0'] : []
    if (versions.length === 0) {
      response.writeHead(404).end()
      return
    }
    const metadata = { name: pathname, 'dist-tags': { latest: versions.at(-1) }, versions: {}, time: {} }
    for (const version of versions) {
      const filename = `${pathname.split('/').at(-1)}-${version}.tgz`
      const contents = packages.get(filename)
      metadata.versions[version] = {
        name: pathname, version,
        dist: {
          tarball: `${registryUrl}/${filename}`,
          shasum: createHash('sha1').update(contents).digest('hex'),
          integrity: `sha512-${createHash('sha512').update(contents).digest('base64')}`,
        },
      }
      metadata.time[version] = new Date(Date.now() - (fresh ? 0 : 10 * 86400000)).toISOString()
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(metadata))
  })

  async function prepareApp(name, dependencies, lockfile = '') {
    const directory = join(root, name)
    await mkdir(directory)
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, private: true, packageManager, dependencies }))
    await writeFile(join(directory, 'yarn.lock'), lockfile.replaceAll('{{APP_NAME}}', name))
    await writeFile(join(directory, '.yarnrc.yml'), stringify({
      nodeLinker: 'node-modules', npmRegistryServer: registryUrl, unsafeHttpWhitelist: ['127.0.0.1'],
      npmMinimalAgeGate: '5d', enableTelemetry: false, enableGlobalCache: false,
      globalFolder: join(directory, '.yarn/global'),
    }))
    return directory
  }

  async function install(directory) {
    try {
      const result = await execute(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['yarn', 'install', '--mode=update-lockfile'], {
        cwd: directory, timeout: 15000,
        env: { ...process.env, COREPACK_ENABLE_NETWORK: '0', YARN_ENABLE_IMMUTABLE_INSTALLS: '0', YARN_ENABLE_HARDENED_MODE: '0' },
      })
      return { status: 0, output: result.stdout + result.stderr }
    } catch (error) {
      return { status: error.code, output: String(error.stdout) + String(error.stderr) }
    }
  }

  try {
    const packageDirectory = join(root, 'package')
    await mkdir(packageDirectory)
    for (const [name, versions] of [['@tiptap/core', ['3.32.2', '3.32.3']], ['editor-lock-unrelated', ['1.0.0']]]) {
      for (const version of versions) {
        await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name, version }))
        const filename = `${name.split('/').at(-1)}-${version}.tgz`
        await create({ gzip: true, cwd: root, file: join(root, filename) }, ['package'])
        packages.set(filename, await readFile(join(root, filename)))
      }
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    registryUrl = `http://127.0.0.1:${server.address().port}`

    const reviewed = await prepareApp('reviewed', { '@tiptap/core': '3.32.2' })
    const approvedInstall = await install(reviewed)
    assert.equal(approvedInstall.status, 0, approvedInstall.output)
    assert.match(approvedInstall.output, new RegExp(`Yarn ${packageManager.split('@')[1].split('+')[0].replaceAll('.', '\\.')}`))
    const dependencies = { '@tiptap/core': '^3.32.2' }
    const seed = buildTemplateEditorLock(await readFile(join(reviewed, 'yarn.lock'), 'utf8'), dependencies)
    fresh = true

    const unseeded = await install(await prepareApp('unseeded', dependencies))
    assert.equal(unseeded.status, 1, unseeded.output)
    assert.match(unseeded.output, /YN0016.*@tiptap\/core/)

    const seededDirectory = await prepareApp('seeded', dependencies, seed)
    const seeded = await install(seededDirectory)
    assert.equal(seeded.status, 0, seeded.output)
    const installed = parse(await readFile(join(seededDirectory, 'yarn.lock'), 'utf8'))
    const editorResolutions = Object.values(installed).filter((entry) => entry.resolution?.startsWith('@tiptap/core@npm:'))
    assert.deepEqual(editorResolutions.map((entry) => entry.version), ['3.32.2'])

    const unrelated = await install(await prepareApp('unrelated', { ...dependencies, 'editor-lock-unrelated': '1.0.0' }, seed))
    assert.equal(unrelated.status, 1, unrelated.output)
    assert.match(unrelated.output, /YN0016.*editor-lock-unrelated/)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
