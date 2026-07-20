import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { detectDocker, parseComposePsOutput, runCaptureSync, runCompose, runStreamingSync } from './compose.mjs'
import { captureInterceptionCas, findVendorCaBundles, harvestWindowsStoreCas, hostTrustEnv, probeTlsInterception, provisionDockerCerts, provisionRancherDesktopCa, summarizeProbeResults, writeCaBundle } from './certs.mjs'
import { loadCompanyConfig, resolveCompanyCertBundles } from './company.mjs'
import { CAPTURED_CA_BUNDLE, DEFAULT_OPENCODE_BASE_IMAGE, OPENCODE_SERVICE_IMAGE, STARTER_STATE_DIR, resolveStackPorts } from './constants.mjs'
import { checkBuildToolchain, checkContainerRuntime, checkGit, checkNodeVersion, checkWsl2 } from './doctor.mjs'
import { ensureEnvFiles } from './env-setup.mjs'
import { readEnvValue } from './env-file.mjs'
import { ensureMcpSharedDir, infraUp } from './infra.mjs'
import { ensureLlmProvider } from './providers.mjs'
import { color, formatDuration, guideBox, statusLine, stepHeader } from './ui.mjs'

// The idempotent convergence pipeline behind `up`. Every step follows the same
// contract so re-running is always safe and always cheap when nothing changed:
//   check(ctx)  -> { ok, detail }        did reality already match the goal?
//   apply(ctx)  -> void (throws on fail) converge; must be a no-op on re-run
//   guide(ctx)  -> string[]              printed when the step cannot self-fix
// A step without apply() is detect-and-guide only (per policy: WSL2 and the
// container runtime are proposed, never installed by us).

export class StepBlocked extends Error {
  constructor(stepId, guide) {
    super(`step blocked: ${stepId}`)
    this.stepId = stepId
    this.guide = guide
  }
}

function stateFile(repoRoot, name) {
  return path.join(repoRoot, STARTER_STATE_DIR, name)
}

function readState(repoRoot, name) {
  try {
    return fs.readFileSync(stateFile(repoRoot, name), 'utf8').trim()
  } catch {
    return null
  }
}

function writeState(repoRoot, name, value) {
  fs.mkdirSync(path.join(repoRoot, STARTER_STATE_DIR), { recursive: true })
  fs.writeFileSync(stateFile(repoRoot, name), `${value}\n`)
}

function hashFiles(repoRoot, files) {
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    const filePath = path.join(repoRoot, file)
    hash.update(file)
    hash.update(fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0))
  }
  return hash.digest('hex')
}

// Fingerprint of every module's Migration*.ts files (name + size, sorted).
// Snapshot dot-files are excluded on purpose: they change alongside schema
// work without requiring `db:migrate`. A stable fingerprint + the initialized
// marker means the database step can skip entirely instead of paying a full
// `yarn db:migrate` no-op on every start.
function walkMigrationModules(repoRoot) {
  const moduleRoots = []
  for (const base of ['packages', path.join('external', 'official-modules', 'packages')]) {
    const baseDir = path.join(repoRoot, base)
    let entries = []
    try {
      entries = fs.readdirSync(baseDir)
    } catch {
      continue
    }
    for (const entry of entries) moduleRoots.push(path.join(baseDir, entry, 'src', 'modules'))
  }
  moduleRoots.push(path.join(repoRoot, 'apps', 'mercato', 'src', 'modules'))
  const modulesWithMigrations = new Map()
  for (const modulesDir of moduleRoots) {
    let modules = []
    try {
      modules = fs.readdirSync(modulesDir)
    } catch {
      continue
    }
    for (const moduleName of modules) {
      const migrationsDir = path.join(modulesDir, moduleName, 'migrations')
      let migrationFiles = []
      try {
        migrationFiles = fs.readdirSync(migrationsDir)
      } catch {
        continue
      }
      for (const file of migrationFiles) {
        if (!file.startsWith('Migration')) continue
        let size = 0
        try {
          size = fs.statSync(path.join(migrationsDir, file)).size
        } catch {
          size = 0
        }
        const files = modulesWithMigrations.get(moduleName) ?? []
        files.push(`${path.relative(repoRoot, path.join(migrationsDir, file))}:${size}`)
        modulesWithMigrations.set(moduleName, files)
      }
    }
  }
  return modulesWithMigrations
}

function listMigrationFiles(repoRoot) {
  return [...walkMigrationModules(repoRoot).values()].flat().sort()
}

export function listMigrationModules(repoRoot) {
  return new Set(walkMigrationModules(repoRoot).keys())
}

export function migrationsFingerprint(repoRoot) {
  return crypto.createHash('sha256').update(listMigrationFiles(repoRoot).join('\n')).digest('hex')
}

// Host-side markers can lie: `db:migrate` may have run against a stale module
// registry (skipping a module's migrations entirely), or the postgres volume
// may have been recreated since the marker was written. Ask the database which
// modules actually have migration bookkeeping (MikroORM keeps one
// mikro_orm_migrations_<module> table per module) so the database step
// converges on reality instead of on its own notes. Returns null when the
// probe cannot run (postgres not up yet, compose unavailable) — callers fall
// back to marker-only behavior.
export function readAppliedMigrationModules(ctx, { runComposeImpl = runCompose } = {}) {
  const dbUrl = readEnvValue(path.join(ctx.repoRoot, 'apps', 'mercato', '.env'), 'DATABASE_URL') ?? ''
  const dbName = dbUrl.split('/').pop()?.split('?')[0]?.trim() || 'open-mercato'
  let result
  try {
    result = runComposeImpl(ctx.repoRoot, [
      'exec', '-T', 'postgres',
      'psql', '-U', 'postgres', '-d', dbName, '-t', '-A', '-c',
      "select table_name from information_schema.tables where table_schema='public' and table_name like 'mikro_orm_migrations%'",
    ], { stdio: 'pipe' })
  } catch {
    return null
  }
  if (result.status !== 0) return null
  return new Set(
    String(result.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((tableName) => tableName.replace(/^mikro_orm_migrations_?/, ''))
      .filter(Boolean),
  )
}

// `--clean` support: drop the convergence markers (install/build/migrations)
// so the next `up` re-runs those steps. Keeps the remembered mode AND the
// db-initialized markers — --clean does not touch data, and `yarn initialize`
// hard-aborts when it finds existing users; wiping THAT state is `reset`'s job.
export function clearConvergenceState(repoRoot) {
  const stateDir = path.join(repoRoot, STARTER_STATE_DIR)
  let entries = []
  try {
    entries = fs.readdirSync(stateDir)
  } catch {
    return []
  }
  const cleared = []
  for (const entry of entries) {
    if (entry === 'mode' || entry.startsWith('db-initialized-')) continue
    fs.rmSync(path.join(stateDir, entry), { force: true })
    cleared.push(entry)
  }
  return cleared
}

// On managed Windows machines Node often lives in Program Files where
// `corepack enable` cannot write the yarn shim without admin; corepack itself
// still runs the project-pinned yarn. Callers switch via ctx.yarnViaCorepack.
export function yarnInvocation(ctx, args) {
  return ctx.yarnViaCorepack
    ? { command: 'corepack', args: ['yarn', ...args] }
    : { command: 'yarn', args }
}

function runYarn(ctx, args) {
  const invocation = yarnInvocation(ctx, args)
  const status = runStreamingSync(invocation.command, invocation.args, { cwd: ctx.repoRoot, env: ctx.env })
  if (status !== 0) {
    throw new Error(`yarn ${args.join(' ')} failed (exit ${status}) — fix the error above and re-run; completed steps are skipped.`)
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

export const prerequisitesStep = {
  id: 'prerequisites',
  expectation: 'instant (activates yarn via corepack when missing)',
  title: 'Toolchain (Node 24, yarn, git)',
  async check(ctx) {
    const node = checkNodeVersion()
    const git = checkGit()
    const yarnRun = runCaptureSync('yarn', ['--version'])
    const yarnOk = !yarnRun.error && yarnRun.status === 0
    if (node.level === 'fail' || git.level === 'fail') {
      const blockers = [node, git].filter((entry) => entry.level === 'fail')
      throw new StepBlocked(this.id, blockers.flatMap((entry) => [`${entry.title}: ${entry.detail}`, ...entry.guide]))
    }
    ctx.hasYarn = yarnOk
    return { ok: yarnOk, detail: yarnOk ? `node v${process.versions.node}, yarn ${String(yarnRun.stdout).trim()}` : 'yarn missing — activating via corepack' }
  },
  async apply(ctx) {
    // Node exists (we are running on it), so yarn is ours to install: enable
    // corepack and activate the exact version pinned in package.json.
    const spec = JSON.parse(fs.readFileSync(path.join(ctx.repoRoot, 'package.json'), 'utf8')).packageManager.split('+')[0]
    const enable = runStreamingSync('corepack', ['enable'], { cwd: ctx.repoRoot, env: ctx.env })
    if (enable !== 0) ctx.log('⚠️ corepack enable failed (PATH not writable?) — falling back to running yarn through corepack.')
    const prepare = runStreamingSync('corepack', ['prepare', spec, '--activate'], { cwd: ctx.repoRoot, env: ctx.env })
    if (prepare !== 0) {
      throw new Error(`corepack prepare ${spec} failed. Behind a corporate proxy? Set HTTPS_PROXY and re-run — the starter provisions the corporate CA automatically in the next step; if this step itself is blocked, set COREPACK_NPM_REGISTRY to your internal mirror (see starters/company/).`)
    }
    const shim = runCaptureSync('yarn', ['--version'], { cwd: ctx.repoRoot, env: ctx.env })
    if (shim.error || shim.status !== 0) {
      // Managed devices: Node in Program Files means `corepack enable` cannot
      // write the yarn shim without admin. Corepack itself still runs the
      // activated yarn, so route every yarn call through it.
      const viaCorepack = runCaptureSync('corepack', ['yarn', '--version'], { cwd: ctx.repoRoot, env: ctx.env })
      if (viaCorepack.error || viaCorepack.status !== 0) {
        throw new Error('yarn is still not runnable after corepack activation. Ask IT to allow `corepack enable`, or install yarn per-user, then re-run.')
      }
      ctx.yarnViaCorepack = true
      ctx.log(`   yarn ${String(viaCorepack.stdout).trim()} activated (no PATH shim — running yarn through corepack)`)
    }
  },
}

export const containerRuntimeStep = {
  id: 'container-runtime',
  expectation: 'instant check; install guidance if missing',
  title: 'Container runtime (Docker Desktop / Rancher Desktop / engine)',
  appliesTo: (ctx) => !ctx.flags.noInfra,
  async check(ctx) {
    const runtime = checkContainerRuntime()
    if (runtime.level === 'pass') return { ok: true, detail: runtime.detail }
    // Policy: we never install WSL2 or a container runtime — propose only.
    const wsl = checkWsl2()
    const guide = []
    if (wsl && wsl.level !== 'pass') guide.push(`WSL2 first: ${wsl.detail}`, ...wsl.guide, '')
    guide.push(...runtime.guide)
    guide.push('', 'Re-run this starter once the runtime is up — every completed step is skipped.')
    if (ctx.mode === 'hybrid') guide.push('No container runtime at all? `up --no-infra` starts just the app against services you point .env at.')
    throw new StepBlocked(this.id, guide)
  },
}

export const corporateCertsStep = {
  id: 'corporate-certs',
  expectation: 'a few seconds (network probes)',
  title: 'Corporate TLS trust (proxy CA capture + provisioning)',
  async check(ctx) {
    const companyBundles = resolveCompanyCertBundles(ctx.repoRoot, ctx.company)
    const vendorBundles = findVendorCaBundles()
    const probes = await probeTlsInterception()
    const { intercepted, unreachable } = summarizeProbeResults(probes)
    ctx.tlsProbes = probes
    if (intercepted.length === 0 && companyBundles.length === 0 && vendorBundles.length === 0) {
      if (unreachable.length > 0) {
        ctx.log(`   ⚠️ unreachable during TLS probe: ${unreachable.map((entry) => `${entry.host} (${entry.reason})`).join(', ')} — continuing; expect trouble if installs need those hosts.`)
      }
      return { ok: true, detail: 'no TLS interception detected' }
    }
    ctx.certsWork = { companyBundles: [...companyBundles, ...vendorBundles], intercepted }
    return { ok: false, detail: intercepted.length > 0 ? `interception detected on ${intercepted.map((entry) => entry.host).join(', ')}` : 'corporate CA bundle(s) found' }
  },
  async apply(ctx) {
    const { companyBundles, intercepted } = ctx.certsWork
    let captured = []
    if (intercepted.length > 0 && ctx.company.certs.capture) {
      // Two capture channels, merged: what the proxy presents on the wire
      // (intermediates rotate — Zscaler rotates weekly) and what group policy
      // deployed into the Windows store (the root often is NOT on the wire).
      captured = await captureInterceptionCas(intercepted.map((entry) => entry.host))
      const harvested = harvestWindowsStoreCas()
      const known = new Set(captured.map((cert) => cert.fingerprint))
      for (const cert of harvested) {
        if (!known.has(cert.fingerprint)) captured.push(cert)
      }
      for (const cert of captured) ctx.log(`   trusted CA: ${cert.subject}`)
      if (captured.length === 0 && companyBundles.length === 0) {
        throw new Error('TLS interception detected but no CA could be captured. Ask IT for the corporate root CA (PEM) and point starters/company/config.mjs certs.bundles at it.')
      }
    }
    const bundlePath = writeCaBundle(ctx.repoRoot, { companyBundles, capturedPems: captured })
    if (!bundlePath) return
    ctx.env = hostTrustEnv(bundlePath, ctx.env)
    const provisioned = provisionDockerCerts(ctx.repoRoot, bundlePath)
    ctx.log(`   host tooling: NODE_EXTRA_CA_CERTS=${path.relative(ctx.repoRoot, bundlePath)} + --use-system-ca`)
    for (const target of provisioned) ctx.log(`   image builds:  ${path.relative(ctx.repoRoot, target)} (baked into app/opencode images)`)
    const rancherScript = provisionRancherDesktopCa(ctx.repoRoot, bundlePath)
    if (rancherScript) ctx.log(`   rancher engine: ${rancherScript} (applied on the next Rancher Desktop restart)`)
    if (process.platform === 'win32') {
      // Mixed fleets: schannel became the fresh-install default only in Git
      // 2.48.1, upgrades keep the old openssl choice — set it explicitly so
      // git trusts the GPO-deployed root from the Windows store.
      const gitConfig = spawnSync('git', ['config', '--global', 'http.sslBackend', 'schannel'], { stdio: 'ignore', windowsHide: true })
      if (!gitConfig.error && gitConfig.status === 0) ctx.log('   git: http.sslBackend=schannel (uses the Windows certificate store)')
      ctx.log('   ↳ persist for your own shells:  setx NODE_EXTRA_CA_CERTS "' + bundlePath + '"')
      ctx.log('   ↳ Docker Desktop reads the Windows certificate store — restart it after IT installs new CAs.')
    } else {
      ctx.log(`   ↳ persist for your own shells:  export NODE_EXTRA_CA_CERTS="${bundlePath}"`)
    }
  },
}

export const buildToolchainStep = {
  id: 'build-toolchain',
  expectation: 'instant check; install guidance if missing',
  title: 'C++ build toolchain (native Node modules)',
  // Only hybrid builds native addons on the host; --mode docker compiles them
  // in the container. The check itself is Windows-only (returns null elsewhere).
  appliesTo: (ctx) => ctx.mode === 'hybrid' && process.platform === 'win32',
  async check() {
    const toolchain = checkBuildToolchain()
    if (!toolchain || toolchain.level === 'pass') {
      return { ok: true, detail: toolchain?.detail ?? 'not required on this platform' }
    }
    // Fail fast with the fix instead of letting `yarn install` faceplant on
    // node-gyp after several minutes. Propose-only: we never install it.
    throw new StepBlocked(this.id, toolchain.guide)
  },
}

export const envFilesStep = {
  id: 'env-files',
  expectation: 'instant; secrets generated once, never rotated',
  title: 'Environment files (.env, secrets)',
  async check() {
    // ensureEnvFiles is fill-missing-only and cheap — always converge.
    return { ok: false, detail: 'converging (never overwrites existing values)' }
  },
  async apply(ctx) {
    ensureEnvFiles(ctx.repoRoot, { log: (line) => ctx.log(`   ${line}`), warn: (line) => ctx.log(`   ⚠️ ${line}`), extraDefaults: ctx.company.env })
  },
}

export const workspaceInstallStep = {
  id: 'workspace-install',
  expectation: 'a few minutes on the first run, skipped afterwards',
  title: 'Workspace dependencies (yarn install)',
  async check(ctx) {
    const current = hashFiles(ctx.repoRoot, ['yarn.lock', 'package.json'])
    ctx.installHash = current
    const previous = readState(ctx.repoRoot, 'install.hash')
    const nodeModulesExists = fs.existsSync(path.join(ctx.repoRoot, 'node_modules'))
    return { ok: nodeModulesExists && previous === current, detail: nodeModulesExists && previous === current ? 'lockfile unchanged' : 'lockfile changed or first run' }
  },
  async apply(ctx) {
    if (ctx.company.mirrors.npmRegistry) {
      ctx.env = { ...ctx.env, COREPACK_NPM_REGISTRY: ctx.company.mirrors.npmRegistry, YARN_NPM_REGISTRY_SERVER: ctx.company.mirrors.npmRegistry }
    }
    runYarn(ctx, ['install'])
    writeState(ctx.repoRoot, 'install.hash', ctx.installHash)
    ctx.installChanged = true
  },
}

export const workspaceBuildStep = {
  id: 'workspace-build',
  expectation: '1-3 minutes on the first run, cached by turbo afterwards',
  title: 'Build workspace packages + generate module artifacts',
  async check(ctx) {
    // The database step shells out to the `mercato` CLI, which only exists
    // after packages are built (turbo's db:migrate task declares no build
    // dependency) — so this must converge before any DB work on a fresh clone.
    const cliBuilt = fs.existsSync(path.join(ctx.repoRoot, 'packages', 'cli', 'dist', 'bin.js'))
    return { ok: cliBuilt && !ctx.installChanged, detail: cliBuilt && !ctx.installChanged ? 'packages built, dependencies unchanged' : 'building (turbo caches make re-runs fast)' }
  },
  async apply(ctx) {
    runYarn(ctx, ['build:packages'])
    runYarn(ctx, ['generate'])
  },
}

export const llmProviderStep = {
  id: 'llm-provider',
  expectation: 'waits for your input on first run; have an API key ready',
  title: 'AI provider (LLM API key)',
  async apply(ctx) {
    const outcome = await ensureLlmProvider({
      rootEnv: path.join(ctx.repoRoot, '.env'),
      appEnv: path.join(ctx.repoRoot, 'apps', 'mercato', '.env'),
    }, {
      skipPrompt: ctx.flags.skipLlmPrompt,
      nonInteractive: ctx.flags.nonInteractive,
      log: (line) => ctx.log(`   ${line}`),
      warn: (line) => ctx.log(`   ⚠️ ${line}`),
    })
    if (outcome === 'failed') {
      throw new Error('No LLM provider configured. Pass --skip-llm-prompt to continue without AI, or set a provider key in .env.')
    }
  },
  async check() {
    return { ok: false, detail: 'checking configured provider' }
  },
}

export function resolveOpencodeBaseImage(repoRoot, env = process.env) {
  return env.OPENCODE_BASE_IMAGE
    ?? readEnvValue(path.join(repoRoot, '.env'), 'OPENCODE_BASE_IMAGE')?.trim()
    ?? DEFAULT_OPENCODE_BASE_IMAGE
}

// The published image is a BASE (OpenCode binary + user, no entrypoint or
// agents — docker/opencode/BASE_IMAGE.md); the runnable service image is the
// thin local build FROM it. The only network step is the base pull, which
// goes through the engine's trust (OS certificate store on Docker/Rancher
// Desktop) and therefore survives corporate TLS interception that breaks
// build-stage egress; the thin build itself only COPYs project files.
// --rebuild forces the thin rebuild (e.g. after yarn generate in prod mode).
export function ensureOpencodeImage(ctx) {
  const baseImage = resolveOpencodeBaseImage(ctx.repoRoot, ctx.env)
  const baseExists = spawnSync('docker', ['image', 'inspect', baseImage], { stdio: 'ignore' }).status === 0
  if (baseExists) {
    ctx.log(`   opencode base image: ${baseImage} (already present)`)
  } else {
    ctx.log(`   pulling OpenCode base image ${baseImage} ...`)
    const pull = spawnSync('docker', ['pull', baseImage], { stdio: 'inherit' })
    if (pull.status !== 0) {
      throw new Error(`Could not pull the OpenCode base image ${baseImage}. Behind a proxy that blocks registry-1.docker.io? Set OPENCODE_BASE_IMAGE in .env to your internal mirror (build/push runbook: docker/opencode/BASE_IMAGE.md), then re-run.`)
    }
  }
  const serviceExists = spawnSync('docker', ['image', 'inspect', OPENCODE_SERVICE_IMAGE], { stdio: 'ignore' }).status === 0
  if (serviceExists && !ctx.flags.rebuild) {
    ctx.log(`   opencode image: ${OPENCODE_SERVICE_IMAGE} (already built)`)
    return
  }
  ctx.log(`   building ${OPENCODE_SERVICE_IMAGE} from ${baseImage} (project files only — no network) ...`)
  const build = spawnSync('docker', [
    'build',
    '-t', OPENCODE_SERVICE_IMAGE,
    '--build-arg', `OPENCODE_BASE_IMAGE=${baseImage}`,
    path.join(ctx.repoRoot, 'docker', 'opencode'),
  ], { stdio: 'inherit', cwd: ctx.repoRoot })
  if (build.status !== 0) {
    throw new Error('Local build of the OpenCode service image failed — see the output above, then re-run.')
  }
}

export const infraUpStep = {
  id: 'infra-up',
  expectation: 'first run pulls the OpenCode base image (a few minutes); seconds afterwards',
  title: 'Infra containers (postgres, redis, meilisearch, opencode)',
  appliesTo: (ctx) => ctx.mode === 'hybrid' && !ctx.flags.noInfra,
  async check(ctx) {
    const ps = runCompose(ctx.repoRoot, ['ps', '--format', 'json'], { stdio: 'pipe' })
    const services = parseComposePsOutput(ps.stdout ?? '')
    const running = new Set(services.filter((entry) => entry.State === 'running').map((entry) => entry.Service))
    const required = ['postgres', 'redis', 'meilisearch', 'opencode']
    const missing = required.filter((service) => !running.has(service))
    ctx.infraMissing = missing
    return { ok: missing.length === 0 && !ctx.flags.rebuild, detail: missing.length === 0 ? 'all infra containers running' : `starting: ${missing.join(', ')}` }
  },
  async apply(ctx) {
    const ports = resolveStackPorts(ctx.repoRoot)
    ensureMcpSharedDir(ctx.repoRoot)
    ensureOpencodeImage(ctx)
    const status = infraUp(ctx.repoRoot, { build: false, profiles: ctx.flags.profiles })
    if (status !== 0) {
      const hints = ['docker compose up failed — see the output above. Re-running resumes from this step.']
      if (ctx.tlsProbes?.some((entry) => entry.status === 'intercepted')) {
        hints.push('TLS/certificate errors from the engine usually mean it does not trust the corporate CA yet: restart Docker Desktop (it re-imports the Windows certificate store) or Rancher Desktop (the starter wrote a provisioning script for it), then re-run.')
      }
      hints.push(`Port conflicts? Something else may own ${ports.postgres}/${ports.redis}/${ports.meilisearch}/${ports.opencode} — override the *_PORT vars in .env.`)
      throw new Error(hints.join('\n'))
    }
  },
}

export const databaseStep = {
  id: 'database',
  expectation: 'migrations + seed take a minute or two on first run',
  title: 'Database (migrations + first-run initialization)',
  appliesTo: (ctx) => !ctx.flags.skipDb,
  async check(ctx) {
    const dbUrl = readEnvValue(path.join(ctx.repoRoot, 'apps', 'mercato', '.env'), 'DATABASE_URL') ?? ''
    const dbKey = crypto.createHash('sha256').update(dbUrl).digest('hex').slice(0, 12)
    ctx.dbMarker = `db-initialized-${dbKey}`
    ctx.dbMigrationsMarker = `db-migrations-${dbKey}`
    ctx.migrationsFingerprint = migrationsFingerprint(ctx.repoRoot)
    const initialized = readState(ctx.repoRoot, ctx.dbMarker) !== null
    const migrated = readState(ctx.repoRoot, ctx.dbMigrationsMarker) === ctx.migrationsFingerprint

    const applied = readAppliedMigrationModules(ctx)
    if (applied) {
      if (applied.size === 0 && initialized) {
        // Markers say converged but the database has no migration bookkeeping
        // at all: the postgres volume was recreated underneath us.
        ctx.dbReinitialize = true
        return { ok: false, detail: 'database is empty (volume recreated?) — migrate + initialize' }
      }
      // Modules that stayed without bookkeeping after the last successful
      // apply are disabled modules — expected to be missing, not pending.
      const knownAbsent = new Set((readState(ctx.repoRoot, `${ctx.dbMigrationsMarker}-absent`) ?? '').split(',').filter(Boolean))
      const missing = [...listMigrationModules(ctx.repoRoot)].filter(
        (moduleName) => !applied.has(moduleName) && !knownAbsent.has(moduleName),
      )
      if (missing.length > 0) {
        return { ok: false, detail: `no migration bookkeeping for: ${missing.join(', ')} — applying pending migrations` }
      }
    }

    if (initialized && migrated) {
      return { ok: true, detail: 'database initialized, no new migration files' }
    }
    return { ok: false, detail: initialized ? 'new migration files — applying pending migrations' : 'first run — migrate + initialize' }
  },
  async apply(ctx) {
    runYarn(ctx, ['db:migrate'])
    writeState(ctx.repoRoot, ctx.dbMigrationsMarker, ctx.migrationsFingerprint)
    const applied = readAppliedMigrationModules(ctx)
    if (applied && applied.size > 0) {
      const stillAbsent = [...listMigrationModules(ctx.repoRoot)].filter((moduleName) => !applied.has(moduleName))
      writeState(ctx.repoRoot, `${ctx.dbMigrationsMarker}-absent`, stillAbsent.join(','))
    }
    if (readState(ctx.repoRoot, ctx.dbMarker) === null || ctx.dbReinitialize) {
      runYarn(ctx, ['initialize'])
      writeState(ctx.repoRoot, ctx.dbMarker, new Date().toISOString())
    }
  },
}

export function buildUpSteps(ctx) {
  const base = [
    prerequisitesStep,
    containerRuntimeStep,
    buildToolchainStep,
    corporateCertsStep,
    envFilesStep,
    workspaceInstallStep,
    workspaceBuildStep,
    llmProviderStep,
    infraUpStep,
    databaseStep,
  ]
  const disabled = new Set(ctx.company.steps.disable)
  return [...base.filter((step) => !disabled.has(step.id)), ...ctx.company.steps.extra]
}

export async function createStepContext(repoRoot, { mode = 'hybrid', flags = {}, log = console.log } = {}) {
  const company = await loadCompanyConfig(repoRoot)
  const existingBundle = path.join(repoRoot, CAPTURED_CA_BUNDLE)
  // --use-system-ca / proxy env fixes apply even before any capture ran; the
  // bundle is added when it already exists from a previous run.
  const env = hostTrustEnv(fs.existsSync(existingBundle) ? existingBundle : null)
  return {
    repoRoot,
    company,
    mode,
    env,
    log,
    flags: {
      nonInteractive: false,
      skipLlmPrompt: false,
      skipDb: false,
      noInfra: false,
      rebuild: false,
      clean: false,
      profiles: [],
      ...flags,
    },
  }
}

export async function runSteps(steps, ctx) {
  const active = steps.filter((step) => !step.appliesTo || step.appliesTo(ctx))
  let index = 0
  for (const step of active) {
    index += 1
    stepHeader(index, active.length, step.title, step.expectation, { log: ctx.log })
    const startedAt = Date.now()
    try {
      const checked = step.check ? await step.check(ctx) : { ok: false, detail: '' }
      if (checked.ok) {
        statusLine('ok', `${checked.detail || 'already satisfied'} ${color.dim('(skipped — already done)')}`, { log: ctx.log })
        continue
      }
      if (checked.detail) statusLine('info', checked.detail, { log: ctx.log })
      if (!step.apply) continue
      await step.apply(ctx)
      statusLine('ok', `done ${color.dim(`in ${formatDuration(Date.now() - startedAt)}`)}`, { log: ctx.log })
    } catch (error) {
      if (error instanceof StepBlocked) {
        statusLine('fail', 'blocked — this starter proposes, it does not install system components', { log: ctx.log })
        guideBox('What to do next', error.guide, { log: ctx.log })
        return { ok: false, blockedStep: step.id }
      }
      statusLine('fail', error instanceof Error ? error.message : String(error), { log: ctx.log })
      return { ok: false, failedStep: step.id }
    }
  }
  return { ok: true }
}
