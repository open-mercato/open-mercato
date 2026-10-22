import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// #7791: `yarn setup` in a generated app checks Docker, starts the infra and
// waits for health before any database step; `--no-infra` makes zero Docker
// calls. These tests run the shipped template scripts against a fake `docker`
// on PATH that logs every invocation, and a stub `scripts/dev.mjs` that records
// what setup forwarded to it.

const TEMPLATE_SCRIPTS = fileURLToPath(new URL('../../template/scripts/', import.meta.url))
const SHIPPED_SCRIPTS = ['setup.mjs', 'infra.mjs', 'dev-infra-preflight.mjs', 'dev-database-url.mjs']
const skip = process.platform === 'win32' ? 'fake docker shim is a POSIX shell script' : false

const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  --version) [ "$FAKE_DOCKER_MODE" = "no-cli" ] && exit 127; echo "Docker version 27.3.1"; exit 0 ;;
  info)
    [ "$FAKE_DOCKER_MODE" = "daemon-stopped" ] && { echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1; }
    echo "27.3.1"; exit 0 ;;
  compose)
    [ "$FAKE_DOCKER_MODE" = "no-compose" ] && { echo "docker: 'compose' is not a docker command." >&2; exit 1; }
    case "$*" in
      *" ps "*)
        if [ "$FAKE_DOCKER_MODE" = "unhealthy" ] && [ -f "$FAKE_DOCKER_LOG.up" ]; then
          echo '{"Service":"postgres","State":"running","Health":"healthy"}'
          echo '{"Service":"redis","State":"running","Health":"healthy"}'
          echo '{"Service":"meilisearch","State":"running","Health":"unhealthy"}'
        fi
        exit 0 ;;
      *" up "*)
        touch "$FAKE_DOCKER_LOG.up"
        [ "$FAKE_DOCKER_MODE" = "unhealthy" ] && exit 1
        exit 0 ;;
      *) exit 0 ;;
    esac ;;
esac
exit 0
`

const DEV_STUB = `import fs from 'node:fs'
fs.writeFileSync(process.env.FAKE_DEV_ARGS_LOG, JSON.stringify(process.argv.slice(2)))
`

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function makeApp() {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-setup-infra-'))
  fs.mkdirSync(path.join(appDir, 'scripts'))
  for (const file of SHIPPED_SCRIPTS) {
    fs.copyFileSync(path.join(TEMPLATE_SCRIPTS, file), path.join(appDir, 'scripts', file))
  }
  fs.writeFileSync(path.join(appDir, 'scripts', 'dev.mjs'), DEV_STUB)
  fs.mkdirSync(path.join(appDir, 'node_modules', 'cross-spawn'), { recursive: true })
  const binDir = path.join(appDir, 'fake-bin')
  fs.mkdirSync(binDir)
  fs.writeFileSync(path.join(binDir, 'docker'), FAKE_DOCKER, { mode: 0o755 })
  const emptyBinDir = path.join(appDir, 'no-docker-bin')
  fs.mkdirSync(emptyBinDir)
  const ports = { POSTGRES_PORT: await freePort(), REDIS_PORT: await freePort(), MEILISEARCH_PORT: await freePort() }
  return { appDir, binDir, emptyBinDir, ports }
}

type RunOptions = { withDocker?: boolean; mode?: string; env?: Record<string, string> }

async function runScript(app: Awaited<ReturnType<typeof makeApp>>, script: string, args: string[], options: RunOptions = {}) {
  const dockerLog = path.join(app.appDir, 'docker.log')
  const devArgsLog = path.join(app.appDir, 'dev-args.json')
  const nodeDir = path.dirname(process.execPath)
  const pathEntries = options.withDocker === false ? [app.emptyBinDir] : [app.binDir, nodeDir, '/usr/bin', '/bin']
  const child = spawn(process.execPath, [path.join('scripts', script), ...args], {
    cwd: app.appDir,
    env: {
      PATH: pathEntries.join(path.delimiter),
      HOME: app.appDir,
      FAKE_DOCKER_LOG: dockerLog,
      FAKE_DOCKER_MODE: options.mode ?? 'ok',
      FAKE_DEV_ARGS_LOG: devArgsLog,
      ...Object.fromEntries(Object.entries(app.ports).map(([key, value]) => [key, String(value)])),
      ...options.env,
    },
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const code: number = await new Promise((resolve) => child.on('close', (exitCode) => resolve(exitCode ?? 1)))
  const dockerCalls = fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean) : []
  const devArgs: string[] | null = fs.existsSync(devArgsLog) ? JSON.parse(fs.readFileSync(devArgsLog, 'utf8')) : null
  return { code, output, dockerCalls, devArgs }
}

test('yarn setup --no-infra makes zero docker calls and forwards the opt-out to the dev runner', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--no-infra'])
    assert.equal(run.code, 0, run.output)
    assert.deepEqual(run.dockerCalls, [])
    assert.deepEqual(run.devArgs, ['--setup', '--no-infra'])
    assert.match(run.output, /--no-infra: skipping Docker/)
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('yarn setup creates .env from .env.example only when it is missing', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.writeFileSync(path.join(app.appDir, '.env.example'), 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/example\n')
    const first = await runScript(app, 'setup.mjs', ['--no-infra'])
    assert.equal(first.code, 0, first.output)
    assert.match(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), /localhost:5432\/example/)

    fs.writeFileSync(path.join(app.appDir, '.env'), 'DATABASE_URL=postgres://me:pw@db.example.com:5432/custom\n')
    const second = await runScript(app, 'setup.mjs', ['--no-infra'])
    assert.equal(second.code, 0, second.output)
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), 'DATABASE_URL=postgres://me:pw@db.example.com:5432/custom\n')
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('yarn setup keeps a remote DATABASE_URL and says so instead of switching to the local container', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), 'DATABASE_URL=postgres://me:pw@db.example.com:5432/custom\n')
    const run = await runScript(app, 'setup.mjs', [])
    assert.equal(run.code, 0, run.output)
    assert.match(run.output, /DATABASE_URL points at db\.example\.com; it is kept as is/)
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), 'DATABASE_URL=postgres://me:pw@db.example.com:5432/custom\n')
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('classic and reinstall wrappers keep their semantics and forward --no-infra', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--reinstall', '--classic', '--no-infra', '--database-name=review_db'])
    assert.equal(run.code, 0, run.output)
    assert.deepEqual(run.dockerCalls, [])
    assert.deepEqual(run.devArgs, ['--setup', '--reinstall', '--classic', '--no-infra', '--database-name=review_db'])
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('yarn setup starts the infra with a health wait before handing over to the dev runner', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--classic'])
    assert.equal(run.code, 0, run.output)
    const upIndex = run.dockerCalls.findIndex((call) => call === 'compose up -d --wait')
    assert.ok(upIndex > 0, run.dockerCalls.join('\n'))
    assert.ok(run.dockerCalls.slice(0, upIndex).includes('info --format {{.ServerVersion}}'))
    assert.ok(!run.dockerCalls.some((call) => /\bdown\b|--volumes|volume rm/.test(call)))
    assert.deepEqual(run.devArgs, ['--setup', '--classic'])
    assert.match(run.output, /Local infrastructure is up and healthy/)
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

const FAILURES: Array<{ name: string; options: RunOptions; message: RegExp }> = [
  { name: 'missing docker CLI', options: { withDocker: false }, message: /Docker is not installed/ },
  { name: 'missing compose plugin', options: { mode: 'no-compose' }, message: /Docker Compose v2 is not available/ },
  { name: 'stopped daemon', options: { mode: 'daemon-stopped' }, message: /The Docker engine is not running/ },
  { name: 'failed healthcheck', options: { mode: 'unhealthy' }, message: /did not become healthy[\s\S]*meilisearch: running \(unhealthy\)/ },
]

for (const failure of FAILURES) {
  test(`yarn setup stops before any database step on ${failure.name}`, { skip }, async () => {
    const app = await makeApp()
    try {
      const run = await runScript(app, 'setup.mjs', [], failure.options)
      assert.equal(run.code, 2, run.output)
      assert.match(run.output, failure.message)
      assert.match(run.output, /yarn setup --no-infra/)
      assert.equal(run.devArgs, null, 'setup must not continue to install/migrate/initialize')
    } finally {
      fs.rmSync(app.appDir, { recursive: true, force: true })
    }
  })
}

test('yarn setup reports a port held by another process and does not run compose up', { skip }, async () => {
  const app = await makeApp()
  const blocker = net.createServer()
  await new Promise<void>((resolve) => blocker.listen(app.ports.POSTGRES_PORT, '127.0.0.1', () => resolve()))
  try {
    const run = await runScript(app, 'setup.mjs', [])
    assert.equal(run.code, 2, run.output)
    assert.match(run.output, new RegExp(`Port ${app.ports.POSTGRES_PORT} \\(postgres\\) is already in use`))
    assert.match(run.output, /POSTGRES_PORT in \.env/)
    assert.ok(!run.dockerCalls.some((call) => call.startsWith('compose up')))
    assert.equal(run.devArgs, null)
  } finally {
    blocker.close()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('yarn infra:down keeps volumes unless --volumes --yes is given', { skip }, async () => {
  const app = await makeApp()
  try {
    const refused = await runScript(app, 'infra.mjs', ['down', '--volumes'])
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.dockerCalls, [])

    const plain = await runScript(app, 'infra.mjs', ['down'])
    assert.equal(plain.code, 0, plain.output)
    assert.ok(plain.dockerCalls.includes('compose down'))

    const up = await runScript(app, 'infra.mjs', ['up'])
    assert.equal(up.code, 0, up.output)
    assert.ok(up.dockerCalls.includes('compose up -d --wait'))
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('the template ships infra:up / infra:down and every setup variant routes through setup.mjs', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../template/package.json.template', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['infra:up'], 'node ./scripts/infra.mjs up')
  assert.equal(pkg.scripts['infra:down'], 'node ./scripts/infra.mjs down')
  for (const name of ['setup', 'setup:classic', 'setup:reinstall', 'setup:reinstall:classic']) {
    assert.match(pkg.scripts[name], /^node \.\/scripts\/setup\.mjs\b/, name)
  }
})
