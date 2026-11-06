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
const SHIPPED_SCRIPTS = ['setup.mjs', 'infra.mjs', 'dev-infra-preflight.mjs', 'dev-database-url.mjs', 'dev-service-modes.mjs', 'dev-service-connections.mjs', 'dev-database-write-guard.mjs', 'dev-session-guard.mjs']
const skip = process.platform === 'win32' ? 'fake docker shim is a POSIX shell script' : false

const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  ps)
    [ -n "$FAKE_DOCKER_FOREIGN_PORT" ] && echo "abcdef123456"
    exit 0 ;;
  inspect)
    [ -n "$FAKE_DOCKER_FOREIGN_PORT" ] && printf '{"name":"/%s","status":"running","health":"healthy","ports":{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"%s"}]}}\\n' "$FAKE_DOCKER_FOREIGN_NAME" "$FAKE_DOCKER_FOREIGN_PORT"
    exit 0 ;;
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
fs.writeFileSync(process.env.FAKE_DEV_ARGS_LOG + '.session', JSON.stringify({ token: process.env.OM_DEV_SESSION_TOKEN ?? null, workspaceRoot: process.env.OM_DEV_SESSION_WORKSPACE_ROOT ?? null }))
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
  fs.writeFileSync(path.join(appDir, 'scripts', 'dev-database-write-guard.mjs'), `export async function assertDatabaseWriteAllowed({ env = {} } = {}) { if (process.env.FAKE_REMOTE_REJECTION) throw new Error('Remote database writes are blocked for remote.example:5432/app. Pass --allow-remote-database=remote.example:5432/app.'); return { remote: false, connectionEnv: env } }\n`)
  fs.writeFileSync(path.join(appDir, 'scripts', 'dev-service-connections.mjs'), `import fs from 'node:fs'; export async function verifyServiceConnections({ env = {} } = {}) { if (process.env.FAKE_VERIFY_DATABASE_LOG) fs.appendFileSync(process.env.FAKE_VERIFY_DATABASE_LOG, (env.DATABASE_URL || '') + '\\n'); if (process.env.FAKE_CONNECTION_INTERRUPT) process.emit('SIGTERM'); let port = ''; try { port = new URL(env.DATABASE_URL).port } catch {} if (process.env.FAKE_MISSING_DRIVER && !fs.existsSync('node_modules/pg')) throw Object.assign(new Error('[setup] PostgreSQL connection failed (DATABASE_URL). Install project dependencies with yarn install, then retry setup.'), { kind: 'dependency' }); if (process.env.FAKE_CONNECTION_ERROR) throw new Error('[setup] PostgreSQL connection failed. Check credentials in .env.'); if (process.env.FAKE_EXPECT_DATABASE_URL && env.DATABASE_URL !== process.env.FAKE_EXPECT_DATABASE_URL) throw new Error('Verifier received the wrong database URL'); if (process.env.FAKE_CONNECTION_FAILURE || (process.env.FAKE_REJECT_DATABASE_PORT && port === process.env.FAKE_REJECT_DATABASE_PORT)) throw new Error('[setup] PostgreSQL connection failed (DATABASE_URL at postgres://localhost:5432/example). The service rejected the configured credentials. Check .env.'); console.log('SERVICE_CONNECTIONS_VERIFIED'); return { ok: true } }\n`)
  fs.mkdirSync(path.join(appDir, 'node_modules', 'cross-spawn'), { recursive: true })
  const binDir = path.join(appDir, 'fake-bin')
  fs.mkdirSync(binDir)
  fs.writeFileSync(path.join(binDir, 'docker'), FAKE_DOCKER, { mode: 0o755 })
  const emptyBinDir = path.join(appDir, 'no-docker-bin')
  fs.mkdirSync(emptyBinDir)
  const ports = { POSTGRES_PORT: await freePort(), REDIS_PORT: await freePort(), MEILISEARCH_PORT: await freePort() }
  return { appDir, binDir, emptyBinDir, ports }
}

type RunOptions = { withDocker?: boolean; mode?: string; env?: Record<string, string>; scriptsDir?: string; promptAnswer?: string }

async function runScript(app: Awaited<ReturnType<typeof makeApp>>, script: string, args: string[], options: RunOptions = {}) {
  const dockerLog = path.join(app.appDir, 'docker.log')
  const devArgsLog = path.join(app.appDir, 'dev-args.json')
  const nodeDir = path.dirname(process.execPath)
  const pathEntries = options.withDocker === false ? [app.emptyBinDir] : [app.binDir, nodeDir, '/usr/bin', '/bin']
  const preloadArgs = []
  if (options.promptAnswer !== undefined) {
    const preloadPath = path.join(app.appDir, 'interactive-input.mjs')
    fs.writeFileSync(preloadPath, "Object.defineProperty(process.stdin, 'isTTY', { value: true })\n")
    preloadArgs.push('--import', preloadPath)
  }
  const child = spawn(process.execPath, [...preloadArgs, path.join(options.scriptsDir ?? 'scripts', script), ...args], {
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
  let answered = false
  child.stdout.on('data', (chunk) => {
    output += chunk
    if (!answered && options.promptAnswer !== undefined && output.includes('using these pre-existing services? [y/N]')) {
      answered = true
      child.stdin.write(`${options.promptAnswer}\n`)
    }
  })
  child.stderr.on('data', (chunk) => { output += chunk })
  const code: number = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Setup did not finish within 10 seconds: ${output}`))
    }, 10_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('close', (exitCode) => { clearTimeout(timeout); resolve(exitCode ?? 1) })
  })
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
    assert.match(run.output, /--no-infra: skipping Docker Compose/)
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
    const run = await runScript(app, 'setup.mjs', ['--infra'])
    assert.equal(run.code, 0, run.output)
    assert.match(run.output, /DATABASE_URL points at db\.example\.com; it is kept as is/)
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), 'DATABASE_URL=postgres://me:pw@db.example.com:5432/custom\n')
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('classic and reinstall wrappers keep their semantics and forward --no-infra', { skip }, async () => {
  const app = await makeApp()
  fs.writeFileSync(path.join(app.appDir, '.env'), 'DATABASE_URL=postgres://fixture:pw@localhost/original\n')
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), 'DATABASE_URL=postgres://fixture:password@localhost:5432/default_db\n')
    const run = await runScript(app, 'setup.mjs', ['--reinstall', '--classic', '--verbose', '--no-infra', '--database-name=review_db'])
    assert.equal(run.code, 0, run.output)
    assert.deepEqual(run.dockerCalls, [])
    assert.deepEqual(run.devArgs, ['--setup', '--reinstall', '--classic', '--verbose', '--no-infra', '--database-name=review_db'])
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('yarn setup starts the infra with a health wait before handing over to the dev runner', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--classic', '--infra'])
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
      const run = await runScript(app, 'setup.mjs', ['--infra'], failure.options)
      assert.equal(run.code, 2, run.output)
      assert.match(run.output, failure.message)
      assert.match(run.output, /yarn setup --no-infra/)
      assert.match(run.output, /Manual setup:/)
      assert.match(run.output, /yarn install/)
      assert.match(run.output, /yarn dev --no-infra/)
      if (failure.name !== 'failed healthcheck') {
        assert.match(run.output, /https:\/\/github\.com\/open-mercato\/open-mercato#without-docker/)
      }
      assert.equal(run.devArgs, null, 'setup must not continue to install/migrate/initialize')
    } finally {
      fs.rmSync(app.appDir, { recursive: true, force: true })
    }
  })
}

test('without Docker and without an answering database, yarn setup stops with the manual-setup guide', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), `DATABASE_URL=postgres://postgres:postgres@localhost:${app.ports.POSTGRES_PORT}/open-mercato\n`)
    const run = await runScript(app, 'setup.mjs', [], { withDocker: false })
    assert.equal(run.code, 2, run.output)
    assert.match(run.output, /Docker is not installed/)
    assert.match(run.output, /No Docker\? Run PostgreSQL yourself .*#without-docker/)
    assert.equal(run.devArgs, null)
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('yarn setup reports a port held by another process and does not run compose up', { skip }, async () => {
  const app = await makeApp()
  const blocker = net.createServer()
  await new Promise<void>((resolve) => blocker.listen(app.ports.POSTGRES_PORT, '127.0.0.1', () => resolve()))
  try {
    const run = await runScript(app, 'setup.mjs', ['--infra'])
    assert.equal(run.code, 2, run.output)
    assert.match(run.output, new RegExp(`Port ${app.ports.POSTGRES_PORT} \\(postgres\\) is already in use`))
    assert.match(run.output, /set POSTGRES_PORT=\d+ in \.env/)
    for (const port of [app.ports.REDIS_PORT, app.ports.MEILISEARCH_PORT]) assert.doesNotMatch(run.output, new RegExp(`POSTGRES_PORT=${port} `))
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

test('yarn infra:up still runs when the script is reached through a symlinked directory', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.symlinkSync(path.join(app.appDir, 'scripts'), path.join(app.appDir, 'linked-scripts'), 'dir')
    const run = await runScript(app, 'infra.mjs', ['up'], { scriptsDir: 'linked-scripts' })
    assert.equal(run.code, 0, run.output)
    assert.ok(run.dockerCalls.some((call) => call.includes('up -d --wait')), run.dockerCalls.join('\n'))
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('isDirectRun compares real paths and ignores drive-letter case on Windows', async () => {
  const { isDirectRun } = await import(new URL('../../template/scripts/infra.mjs', import.meta.url).href)
  const realpath = (candidate: string) => candidate.replace('/linked/', '/real/')
  assert.equal(isDirectRun('/app/linked/infra.mjs', '/app/real/infra.mjs', { platform: 'linux', realpath }), true)
  assert.equal(isDirectRun('/app/real/setup.mjs', '/app/real/infra.mjs', { platform: 'linux', realpath }), false)
  assert.equal(isDirectRun(undefined, '/app/real/infra.mjs', { platform: 'linux', realpath }), false)
  const identity = (candidate: string) => candidate
  assert.equal(isDirectRun('c:\\app\\scripts\\infra.mjs', 'C:\\app\\scripts\\infra.mjs', { platform: 'win32', realpath: identity }), true)
})


test('plain setup defaults to reusing services without Docker or config rewrites', { skip }, async () => {
  const app = await makeApp()
  try {
    const original = 'DATABASE_URL=postgres://owner:password@db.example.com:6543/custom\n'
    fs.writeFileSync(path.join(app.appDir, '.env'), original)
    const run = await runScript(app, 'setup.mjs', [], { withDocker: false })
    assert.equal(run.code, 0, run.output)
    assert.deepEqual(run.dockerCalls, [])
    assert.deepEqual(run.devArgs, ['--setup', '--no-infra'])
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), original)
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})

test('random ports setup saves matching service URLs before compose and dev', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), 'DATABASE_URL=postgres://me:pw@remote:5432/custom\nREDIS_URL=redis://remote:6379/2\n')
    const run = await runScript(app, 'setup.mjs', ['--random-ports'])
    assert.equal(run.code, 0, run.output)
    const { parseEnv } = await import('node:util')
    const settings = parseEnv(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'))
    assert.equal(new URL(settings.DATABASE_URL).port, settings.POSTGRES_PORT)
    assert.equal(new URL(settings.REDIS_URL).port, settings.REDIS_PORT)
    assert.equal(new URL(settings.MEILISEARCH_HOST).port, settings.MEILISEARCH_PORT)
    assert.ok(run.dockerCalls.includes('compose up -d --wait'))
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})

test('failed dev setup prints the manual fallback and preserves exit status', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.writeFileSync(path.join(app.appDir, 'scripts', 'dev.mjs'), 'process.exit(7)\n')
    const run = await runScript(app, 'setup.mjs', [])
    assert.equal(run.code, 7)
    assert.match(run.output, /Manual setup:[\s\S]*yarn install[\s\S]*yarn generate[\s\S]*yarn dev --no-infra/)
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})

test('ephemeral cleanup failures print manual recovery instructions and fail setup', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.mkdirSync(path.join(app.appDir, 'node_modules', '@open-mercato', 'cli'), { recursive: true })
    const moduleDir = path.join(app.appDir, 'node_modules', 'testcontainers')
    fs.mkdirSync(moduleDir)
    fs.writeFileSync(path.join(moduleDir, 'index.js'), `
      class GenericContainer {
        withEnvironment() { return this }
        withExposedPorts(port) { this.port = port; return this }
        withCommand() { return this }
        withHealthCheck() { return this }
        withWaitStrategy() { return this }
        async start() { return this }
        getHost() { return '127.0.0.1' }
        getMappedPort() { return this.port + 20000 }
        async stop() { throw new Error('simulated cleanup failure') }
      }
      module.exports = { GenericContainer, Wait: { forHealthCheck() {} } }
    `)
    const run = await runScript(app, 'setup.mjs', ['--ephemeral'])
    assert.equal(run.code, 1, run.output)
    assert.match(run.output, /Could not fully restore/)
    assert.match(run.output, /Manual setup:[\s\S]*yarn dev --no-infra/)
    assert.deepEqual(run.devArgs, ['--setup', '--no-infra'])
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})


test('rejected service credentials stop setup before database/dev and print clear recovery instructions', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--reuse-services'], { env: { FAKE_CONNECTION_FAILURE: '1' } })
    assert.equal(run.code, 2, run.output)
    assert.equal(run.devArgs, null)
    assert.match(run.output, /PostgreSQL connection failed[\s\S]*rejected the configured credentials[\s\S]*Check \.env/)
    assert.match(run.output, /Manual setup:[\s\S]*yarn dev --no-infra/)
    assert.deepEqual(run.dockerCalls, [])
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})


test('interrupting service verification prevents database/dev startup', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--reuse-services'], { env: { FAKE_CONNECTION_INTERRUPT: '1' } })
    assert.equal(run.code, 143, run.output)
    assert.equal(run.devArgs, null)
    assert.match(run.output, /Setup interrupted while verifying service connections/)
    assert.deepEqual(run.dockerCalls, [])
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})


test('database-name verification previews the selected database without rewriting env or consuming the dev flags', { skip }, async () => {
  const app = await makeApp()
  try {
    const original = 'DATABASE_URL=postgres://fixture:password@localhost:5432/default_db\n'
    fs.writeFileSync(path.join(app.appDir, '.env'), original)
    const log = path.join(app.appDir, 'verified-url.txt')
    const run = await runScript(app, 'setup.mjs', ['--database-name=selected_db', '--no-update-env', '--reuse-services'], { env: { FAKE_VERIFY_DATABASE_LOG: log } })
    assert.equal(run.code, 0, run.output)
    assert.equal(new URL(fs.readFileSync(log, 'utf8').trim()).pathname, '/selected_db')
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), original)
    assert.deepEqual(run.devArgs, ['--setup', '--no-infra', '--database-name=selected_db', '--no-update-env'])
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})

test('remote database write rejection happens before verification or database/dev startup', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--reuse-services'], { env: { FAKE_REMOTE_REJECTION: '1' } })
    assert.equal(run.code, 2, run.output)
    assert.equal(run.devArgs, null)
    assert.match(run.output, /Remote database writes are blocked.*allow-remote-database/)
    assert.deepEqual(run.dockerCalls, [])
  } finally { fs.rmSync(app.appDir, { recursive: true, force: true }) }
})

async function listenOn(port: number): Promise<net.Server> {
  const server = net.createServer((socket) => socket.end())
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  return server
}

function localDatabaseEnv(app: Awaited<ReturnType<typeof makeApp>>): string {
  return `DATABASE_URL=postgres://postgres:postgres@localhost:${app.ports.POSTGRES_PORT}/open-mercato\n`
}

test('default selection (a): answering services that verify are reused without Compose', { skip }, async () => {
  const app = await makeApp()
  const database = await listenOn(app.ports.POSTGRES_PORT)
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const run = await runScript(app, 'setup.mjs', [])
    assert.equal(run.code, 0, run.output)
    assert.match(run.output, /answer and their credentials verified; reusing them/)
    assert.deepEqual(run.devArgs, ['--setup', '--no-infra'])
    assert.ok(!run.dockerCalls.some((call) => call.startsWith('compose up')), run.dockerCalls.join('\n'))
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), localDatabaseEnv(app))
  } finally {
    database.close()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('default selection (b): nothing answers and Docker works, so Compose starts on the configured ports', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const run = await runScript(app, 'setup.mjs', [])
    assert.equal(run.code, 0, run.output)
    assert.match(run.output, /Nothing answers on the configured ports/)
    assert.ok(run.dockerCalls.includes('compose up -d --wait'), run.dockerCalls.join('\n'))
    assert.deepEqual(run.devArgs, ['--setup'])
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), localDatabaseEnv(app))
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('default selection (c): rejected credentials on the configured port start an isolated stack on free ports', { skip }, async () => {
  const app = await makeApp()
  const database = await listenOn(app.ports.POSTGRES_PORT)
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const run = await runScript(app, 'setup.mjs', [], { env: { FAKE_REJECT_DATABASE_PORT: String(app.ports.POSTGRES_PORT) } })
    assert.equal(run.code, 0, run.output)
    assert.match(run.output, /did not accept the configured settings[\s\S]*isolated stack on free ports/)
    const { parseEnv } = await import('node:util')
    const settings = parseEnv(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'))
    assert.notEqual(settings.POSTGRES_PORT, String(app.ports.POSTGRES_PORT))
    assert.equal(new URL(settings.DATABASE_URL).port, settings.POSTGRES_PORT)
    assert.ok(run.dockerCalls.includes('compose up -d --wait'), run.dockerCalls.join('\n'))
    assert.deepEqual(run.devArgs, ['--setup'])
  } finally {
    database.close()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('default selection (c): another project\'s container on the configured port is never verified or written to', { skip }, async () => {
  const app = await makeApp()
  const database = await listenOn(app.ports.POSTGRES_PORT)
  const verifyLog = path.join(app.appDir, 'verified-urls.txt')
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const run = await runScript(app, 'setup.mjs', [], {
      env: { FAKE_DOCKER_FOREIGN_PORT: String(app.ports.POSTGRES_PORT), FAKE_DOCKER_FOREIGN_NAME: 'other-app-postgres', FAKE_VERIFY_DATABASE_LOG: verifyLog },
    })
    assert.equal(run.code, 0, run.output)
    assert.match(run.output, /container other-app-postgres of another project; starting an isolated stack on free ports/)
    const verified = fs.readFileSync(verifyLog, 'utf8').split('\n').filter(Boolean)
    assert.ok(verified.length > 0)
    for (const url of verified) assert.notEqual(new URL(url).port, String(app.ports.POSTGRES_PORT), 'the foreign database must never be contacted')
    assert.ok(run.dockerCalls.includes('compose up -d --wait'), run.dockerCalls.join('\n'))
  } finally {
    database.close()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('default selection (d): without Docker and without answering services setup stops with the guide', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const started = Date.now()
    const run = await runScript(app, 'setup.mjs', [], { withDocker: false })
    assert.equal(run.code, 2, run.output)
    assert.ok(Date.now() - started < 15_000, 'must fail quickly')
    assert.match(run.output, /Nothing answers on the configured service ports/)
    assert.match(run.output, /Docker is not installed/)
    assert.match(run.output, /No Docker\? Run PostgreSQL yourself \(Redis and Meilisearch are optional\): https:\/\/github\.com\/open-mercato\/open-mercato#without-docker/)
    assert.match(run.output, /yarn setup --no-infra/)
    assert.equal(run.devArgs, null)
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), localDatabaseEnv(app))
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('default selection (d): without Docker, a configured database that rejects credentials stops setup', { skip }, async () => {
  const app = await makeApp()
  const database = await listenOn(app.ports.POSTGRES_PORT)
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const run = await runScript(app, 'setup.mjs', [], { withDocker: false, env: { FAKE_REJECT_DATABASE_PORT: String(app.ports.POSTGRES_PORT) } })
    assert.equal(run.code, 2, run.output)
    assert.match(run.output, /Configured services are not usable/)
    assert.match(run.output, /#without-docker/)
    assert.equal(run.devArgs, null)
  } finally {
    database.close()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('default selection (e): without Docker, configured services that verify are used', { skip }, async () => {
  const app = await makeApp()
  const database = await listenOn(app.ports.POSTGRES_PORT)
  try {
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const run = await runScript(app, 'setup.mjs', [], { withDocker: false })
    assert.equal(run.code, 0, run.output)
    assert.match(run.output, /Docker is not available \(docker CLI not found\), but the services configured in \.env answer/)
    assert.deepEqual(run.devArgs, ['--setup', '--no-infra'])
    assert.deepEqual(run.dockerCalls, [])
  } finally {
    database.close()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('a second setup in a checkout with a live dev session is rejected before any .env write or Compose call', { skip }, async () => {
  const app = await makeApp()
  const { acquireDevSession } = await import(new URL('../../template/scripts/dev-session-guard.mjs', import.meta.url).href)
  const first = acquireDevSession({ workspaceRoot: app.appDir, mode: 'setup', role: 'setup' })
  try {
    const original = `${localDatabaseEnv(app)}POSTGRES_PORT=${app.ports.POSTGRES_PORT}\n`
    fs.writeFileSync(path.join(app.appDir, '.env'), original)
    const run = await runScript(app, 'setup.mjs', ['--random-ports'])
    assert.equal(run.code, 2, run.output)
    assert.match(run.output, /Another Open Mercato dev session already owns this workspace/)
    assert.match(run.output, /No service configuration, \.env file or container was changed/)
    assert.deepEqual(run.dockerCalls, [])
    assert.equal(run.devArgs, null)
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), original)
    const owner = JSON.parse(fs.readFileSync(path.join(app.appDir, '.mercato', 'dev-session.lock', 'owner.json'), 'utf8'))
    assert.equal(owner.token, first.token)
  } finally {
    first.release()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('setup owns the dev session, hands its token to the dev runner and releases it on exit', { skip }, async () => {
  const app = await makeApp()
  try {
    const run = await runScript(app, 'setup.mjs', ['--no-infra'])
    assert.equal(run.code, 0, run.output)
    const session = JSON.parse(fs.readFileSync(path.join(app.appDir, 'dev-args.json.session'), 'utf8'))
    assert.match(session.token ?? '', /^[0-9a-f-]{36}$/i)
    assert.equal(session.workspaceRoot, fs.realpathSync(app.appDir))
    assert.equal(fs.existsSync(path.join(app.appDir, '.mercato', 'dev-session.lock')), false)
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('without Docker and services, a fresh app fails within seconds before yarn install runs', { skip }, async () => {
  const app = await makeApp()
  try {
    fs.rmSync(path.join(app.appDir, 'node_modules'), { recursive: true, force: true })
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const started = Date.now()
    const run = await runScript(app, 'setup.mjs', [], { withDocker: false })
    assert.equal(run.code, 2, run.output)
    assert.ok(Date.now() - started < 15_000, 'must fail quickly')
    assert.match(run.output, /#without-docker/)
    assert.doesNotMatch(run.output, /Dependency installation failed/)
    assert.equal(fs.existsSync(path.join(app.appDir, 'node_modules')), false, 'yarn install must not run before the service decision')
  } finally {
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})

test('credential verification that needs drivers installs dependencies, then decides', { skip }, async () => {
  const app = await makeApp()
  const database = await listenOn(app.ports.POSTGRES_PORT)
  try {
    fs.rmSync(path.join(app.appDir, 'node_modules'), { recursive: true, force: true })
    const yarnLog = path.join(app.appDir, 'yarn.log')
    fs.writeFileSync(path.join(app.binDir, 'yarn'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${yarnLog}"\nmkdir -p node_modules/pg node_modules/cross-spawn\nexit 0\n`, { mode: 0o755 })
    fs.writeFileSync(path.join(app.appDir, '.env'), localDatabaseEnv(app))
    const run = await runScript(app, 'setup.mjs', [], { env: { FAKE_MISSING_DRIVER: '1' } })
    assert.equal(run.code, 0, run.output)
    assert.deepEqual(fs.readFileSync(yarnLog, 'utf8').split('\n').filter(Boolean), ['install'])
    assert.match(run.output, /credentials verified; reusing them/)
    assert.deepEqual(run.devArgs, ['--setup', '--no-infra'])
  } finally {
    database.close()
    fs.rmSync(app.appDir, { recursive: true, force: true })
  }
})
test('setup rejects invalid service credentials before invoking the database/dev runner', { skip }, async (t) => {
  const app = await makeApp()
  t.after(() => fs.rmSync(app.appDir, { recursive: true, force: true }))
  const outcome = await runScript(app, 'setup.mjs', ['--no-infra'], { env: { FAKE_CONNECTION_ERROR: '1' } })
  assert.equal(outcome.code, 2)
  assert.match(outcome.output, /PostgreSQL connection failed/)
  assert.match(outcome.output, /Check credentials in .env/)
  assert.equal(outcome.devArgs, null)
  assert.deepEqual(outcome.dockerCalls, [])
})


for (const selection of ['flag', 'environment']) {
  test(`standalone setup verifies the effective database-name ${selection} override without writing or prompting`, { skip }, async (t) => {
    const app = await makeApp()
    t.after(() => fs.rmSync(app.appDir, { recursive: true, force: true }))
    const original = 'DATABASE_URL=postgres://fixture:pw@localhost/old\n'
    fs.writeFileSync(path.join(app.appDir, '.env'), original)
    const args = ['--no-infra', ...(selection === 'flag' ? ['--database-name=selected', '--no-update-env'] : [])]
    const result = await runScript(app, 'setup.mjs', args, { env: { FAKE_EXPECT_DATABASE_URL: 'postgres://fixture:pw@localhost/selected', ...(selection === 'environment' ? { OM_DEV_DATABASE_NAME: 'selected' } : {}) } })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /SERVICE_CONNECTIONS_VERIFIED/)
    assert.equal(fs.readFileSync(path.join(app.appDir, '.env'), 'utf8'), original)
    assert.doesNotMatch(result.output, /Update .env to use database/)
    assert.deepEqual(result.devArgs, ['--setup', ...args])
  })
}
