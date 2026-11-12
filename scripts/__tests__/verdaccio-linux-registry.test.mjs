import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const enabled = process.env.OM_RUN_VERDACCIO_LINUX_SMOKE === '1'

function run(args, options = {}) {
  return execFileSync(args[0], args.slice(1), {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  })
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

test('native Linux bridge registry advertises downloadable tarballs and supports a cold Yarn install', {
  skip: enabled ? false : 'Set OM_RUN_VERDACCIO_LINUX_SMOKE=1 with a native-Linux Docker daemon',
  timeout: 300_000,
}, async () => {
  assert.equal(process.platform, 'linux')
  const daemon = JSON.parse(run(['docker', 'info', '--format', '{{json .}}']))
  assert.equal(daemon.OSType, 'linux')
  assert.doesNotMatch(daemon.OperatingSystem, /docker desktop/i)
  const gateway = run(['docker', 'network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}']).trim()
  assert.match(gateway, /^(?:\d{1,3}\.){3}\d{1,3}$/)
  const project = 'om-registry-smoke-' + randomUUID().slice(0, 8)
  const directory = await mkdtemp(path.join(tmpdir(), 'om-registry-smoke-'))
  const port = await freePort()
  const registryUrl = `http://${gateway}:${port}`
  const emptyEnv = path.join(directory, 'empty.env')
  await writeFile(emptyEnv, '')
  const baseEnv = { ...process.env, MERCATO_STACK: project }
  for (const key of ['VERDACCIO_HOST', 'VERDACCIO_PORT', 'OM_VERDACCIO_PUBLIC_URL']) delete baseEnv[key]
  const env = { ...baseEnv, VERDACCIO_HOST: gateway, VERDACCIO_PORT: String(port), OM_VERDACCIO_PUBLIC_URL: registryUrl }
  const compose = ['docker', 'compose', '--project-directory', root, '--env-file', emptyEnv, '-p', project, '-f', 'starters/docker/compose.infra.yml', '--profile', 'registry']
  const client = project + '-client'

  try {
    const defaults = JSON.parse(run([...compose, 'config', '--format', 'json'], { env: baseEnv })).services.verdaccio
    assert.equal(defaults.environment.VERDACCIO_PUBLIC_URL, 'http://localhost:4873')
    assert.ok(defaults.ports.length > 0)
    assert.ok(defaults.ports.every((entry) => entry.host_ip === '127.0.0.1'))
    const configured = JSON.parse(run([...compose, 'config', '--format', 'json'], { env })).services.verdaccio
    assert.equal(configured.environment.VERDACCIO_PUBLIC_URL, registryUrl)
    assert.ok(configured.ports.every((entry) => entry.host_ip === gateway && String(entry.published) === String(port)))
    run([...compose, 'up', '-d', '--no-deps', 'verdaccio'], { env })
    let ready = false
    for (let attempt = 0; attempt < 45; attempt += 1) {
      try {
        const response = await fetch(registryUrl + '/-/ping', { signal: AbortSignal.timeout(2_000) })
        if (response.ok) { ready = true; break }
      } catch {}
      await delay(1_000)
    }
    assert.ok(ready, 'The isolated registry did not become ready')

    const name = '@open-mercato/linux-registry-smoke'
    const fixture = path.join(directory, 'package')
    await mkdir(fixture)
    await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.cjs' }))
    await writeFile(path.join(fixture, 'index.cjs'), 'module.exports = "private-registry-route-ok"\n')
    const filename = 'linux-registry-smoke-1.0.0.tgz'
    const tarballPath = path.join(directory, filename)
    run(['tar', '-czf', tarballPath, '-C', directory, 'package'])
    const tarball = await readFile(tarballPath)
    const distribution = {
      tarball: `${registryUrl}/${name}/-/${filename}`,
      shasum: createHash('sha1').update(tarball).digest('hex'),
      integrity: 'sha512-' + createHash('sha512').update(tarball).digest('base64'),
    }
    const version = { name, version: '1.0.0', main: 'index.cjs', dist: distribution }
    const response = await fetch(registryUrl + '/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        _id: name, name, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': version },
        _attachments: { [filename]: { content_type: 'application/octet-stream', data: tarball.toString('base64'), length: tarball.length } },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    assert.equal(response.status, 201)

    const script = `set -eu
mkdir /tmp/cold-install && cd /tmp/cold-install
node - <<'NODE'
const fs = require('node:fs')
fs.writeFileSync('package.json', JSON.stringify({ private: true, packageManager: 'yarn@4.17.1', dependencies: { '@open-mercato/linux-registry-smoke': '1.0.0' } }))
fs.writeFileSync('.yarnrc.yml', 'nodeLinker: node-modules\\nenableGlobalCache: false\\nunsafeHttpWhitelist:\\n  - ' + JSON.stringify(process.env.REGISTRY_HOST) + '\\nnpmScopes:\\n  open-mercato:\\n    npmRegistryServer: ' + JSON.stringify(process.env.REGISTRY_URL) + '\\n    npmMinimalAgeGate: 0\\n')
;(async () => {
  const metadata = await (await fetch(process.env.REGISTRY_URL + '/@open-mercato%2Flinux-registry-smoke')).json()
  const url = metadata.versions['1.0.0'].dist.tarball
  if (!url.startsWith(process.env.REGISTRY_URL + '/')) throw new Error('Advertised tarball is outside the private registry route: ' + url)
  const archive = await fetch(url)
  if (archive.status !== 200 || (await archive.arrayBuffer()).byteLength === 0) throw new Error('Advertised tarball is not downloadable')
})().catch((error) => { console.error(error); process.exitCode = 1 })
NODE
corepack yarn@4.17.1 install
node -e 'if(require("@open-mercato/linux-registry-smoke")!=="private-registry-route-ok")process.exit(1)'
`
    run(['docker', 'run', '--rm', '--name', client, '--network', project + '-network', '--add-host', 'host.docker.internal:host-gateway', '-e', 'REGISTRY_URL=' + registryUrl, '-e', 'REGISTRY_HOST=' + gateway, 'node:24-alpine', 'sh', '-c', script], { timeout: 180_000 })
    const bindings = JSON.parse(run(['docker', 'inspect', project + '-verdaccio']))[0].NetworkSettings.Ports['4873/tcp']
    assert.ok(bindings.length > 0)
    assert.ok(bindings.every((binding) => binding.HostIp === gateway))
  } finally {
    try { run(['docker', 'rm', '-f', client]) } catch {}
    try { run([...compose, 'down', '--volumes', '--remove-orphans'], { env }) } finally { await rm(directory, { recursive: true, force: true }) }
  }
})
