#!/usr/bin/env node
// Open Mercato starter CLI — the single cross-platform brain behind the three
// platform entry scripts (start.sh, start.ps1, start.cmd). The entries only
// guarantee Node 24 exists, then hand every command off to this file.
//
//   up      (default) idempotent converge + start: prerequisites -> corporate
//           TLS trust -> env/secrets -> install -> infra -> database -> dev
//   stop    stop host processes and/or containers
//   status  processes, containers, health, URLs
//   logs    tail the newest dev log (--follow)
//   doctor  read-only audit with remediation + a "hand this to IT" sheet
//   reset   destructive cleanup (asks first)
//   infra   up/down for just the infra containers
//
// Modes: --mode hybrid (default; app + MCP on the host, services in
// containers) or --mode docker (everything containerized — for machines where
// running Node workloads on the host is not allowed). The chosen mode is
// remembered in .mercato/starter/mode.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

import { detectDocker, resolveRepoRoot, runCompose, runStreamingSync, spawnStreaming } from './compose.mjs'
import { readEnvValue } from './env-file.mjs'
import { FULLAPP_DEV_COMPOSE_FILE, STARTER_STATE_DIR, resolveStackPorts, stackUrls } from './constants.mjs'
import { loadCompanyConfig } from './company.mjs'
import { printDoctorReport, runDoctor } from './doctor.mjs'
import { infraDown, infraUp, ensureMcpSharedDir } from './infra.mjs'
import { buildUpSteps, clearConvergenceState, createStepContext, ensureOpencodeImage, runSteps, yarnInvocation } from './steps.mjs'
import { collectStatus, printStatus, readRunState, isPidAlive, startDetached, stopDetached, tailLogs } from './supervise.mjs'
import { ensureWindowsUtf8Console } from './spawn.mjs'
import { color, guideBox, printBanner, statusLine } from './ui.mjs'
import { waitForHealthyServices, waitForHttp } from './waits.mjs'

ensureWindowsUtf8Console()

const repoRoot = resolveRepoRoot()
if (!repoRoot) {
  console.error('❌ No Open Mercato checkout found above the current directory.')
  console.error('   Run `npx @open-mercato/starter` (it clones for you) or cd into a clone first.')
  process.exit(2)
}

function parseArgs(argv) {
  const commands = new Set(['up', 'stop', 'status', 'logs', 'doctor', 'reset', 'infra'])
  const args = [...argv]
  const command = commands.has(args[0]) ? args.shift() : 'up'
  const flags = {
    mode: null,
    detach: false,
    follow: false,
    nonInteractive: false,
    skipLlmPrompt: false,
    skipDb: false,
    noInfra: false,
    rebuild: false,
    clean: false,
    volumes: false,
    yes: false,
    keepInfra: false,
    profiles: [],
    passthrough: [],
    infraAction: null,
  }
  while (args.length > 0) {
    const arg = args.shift()
    if (arg === '--') {
      flags.passthrough = args.splice(0)
      break
    }
    switch (arg) {
      case '--mode':
        flags.mode = args.shift() ?? null
        break
      case '--detach':
      case '-d':
        flags.detach = true
        break
      case '--follow':
      case '-f':
        flags.follow = true
        break
      case '--non-interactive':
        flags.nonInteractive = true
        break
      case '--skip-llm-prompt':
        flags.skipLlmPrompt = true
        break
      case '--skip-db':
        flags.skipDb = true
        break
      case '--no-infra':
        flags.noInfra = true
        break
      case '--rebuild':
        flags.rebuild = true
        break
      case '--clean':
        flags.clean = true
        break
      case '--volumes':
        flags.volumes = true
        break
      case '--yes':
        flags.yes = true
        break
      case '--keep-infra':
        flags.keepInfra = true
        break
      case '--profile':
        if (args[0]) flags.profiles.push(args.shift())
        break
      case 'up':
      case 'down':
        if (command === 'infra') flags.infraAction = arg
        break
      default:
        console.error(`Unknown option: ${arg} (see starters/README.md)`)
        process.exit(1)
    }
  }
  if (!process.stdin.isTTY || process.env.CI === 'true') flags.nonInteractive = true
  return { command, flags }
}

function modeStatePath() {
  return path.join(repoRoot, STARTER_STATE_DIR, 'mode')
}

function resolveMode(flagMode) {
  if (flagMode) {
    if (!['hybrid', 'docker'].includes(flagMode)) {
      console.error(`Unknown --mode '${flagMode}' — use hybrid or docker.`)
      process.exit(1)
    }
    fs.mkdirSync(path.dirname(modeStatePath()), { recursive: true })
    fs.writeFileSync(modeStatePath(), `${flagMode}\n`)
    return flagMode
  }
  try {
    const saved = fs.readFileSync(modeStatePath(), 'utf8').trim()
    if (['hybrid', 'docker'].includes(saved)) return saved
  } catch {
    // fall through to default
  }
  return 'hybrid'
}

async function confirm(question, { nonInteractive }) {
  if (nonInteractive) return false
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve))
  rl.close()
  return /^y/i.test(answer.trim())
}

async function commandUp(flags) {
  const mode = resolveMode(flags.mode)
  if (flags.clean) {
    // Full re-converge: drop the completed-step markers (keeps the mode, all
    // data, and the one-time initialize state — `reset` is the destructive
    // variant) and rebuild the OpenCode service image.
    flags.rebuild = true
    const cleared = clearConvergenceState(repoRoot)
    console.log(color.dim(`  --clean: cleared ${cleared.length} convergence marker(s) — install, build, and migrations will re-run (data untouched).`))
  }
  const ctx = await createStepContext(repoRoot, { mode, flags })
  printBanner(`dev environment starter — mode: ${mode}${ctx.company.name ? ` — company profile: ${ctx.company.name}` : ''}`)
  console.log(color.dim(`  Repo: ${repoRoot}`))
  console.log(color.dim('  Every step is idempotent — re-running always resumes where it stopped.'))

  if (mode === 'docker') return commandUpDocker(ctx, flags)

  const outcome = await runSteps(buildUpSteps(ctx), ctx)
  if (!outcome.ok) {
    guideBox('Setup stopped', [
      'Fix the item above and re-run the same command — completed steps are skipped.',
      'Full environment audit with an IT handout:  yarn om doctor   (or: npx @open-mercato/starter doctor)',
    ])
    process.exit(2)
  }

  const ports = resolveStackPorts(repoRoot)
  const urls = stackUrls(ports)
  console.log('')
  console.log(color.bold(color.green('Environment ready — starting the dev runtime')) + color.dim(' (app + queue workers + scheduler + MCP server)'))
  console.log(`  App:      ${color.cyan(urls.app)}   ${color.dim('(login page appears once the app finishes booting)')}`)
  console.log(`  MCP:      ${color.cyan(urls.mcp)}`)
  console.log(`  OpenCode: ${color.cyan(`http://127.0.0.1:${ports.opencode}`)}`)
  console.log(color.dim(`  Superadmin sign-in: ${readEnvValue(path.join(repoRoot, '.env'), 'OM_INIT_SUPERADMIN_EMAIL')?.trim() || 'superadmin@acme.com'} / ${readEnvValue(path.join(repoRoot, '.env'), 'OM_INIT_SUPERADMIN_PASSWORD')?.trim() || 'secret'}`))
  console.log(color.dim('  Stop: Ctrl+C (infra containers keep running; `stop` shuts everything down)'))
  console.log('')

  if (flags.detach) {
    startDetached(repoRoot, flags.passthrough, { env: ctx.env })
    console.log('Manage it with the status / logs / stop subcommands.')
    return
  }
  const dev = yarnInvocation(ctx, ['dev', ...flags.passthrough])
  const child = spawnStreaming(dev.command, dev.args, { cwd: repoRoot, env: ctx.env })
  child.on('close', (code) => process.exit(code ?? 0))
  child.on('error', (error) => {
    console.error(`❌ Could not start yarn dev: ${error.message}`)
    process.exit(1)
  })
}

async function commandUpDocker(ctx, flags) {
  // Containerized mode: converge trust/env, then let compose own the stack.
  const steps = buildUpSteps(ctx).filter((step) => ['prerequisites', 'container-runtime', 'corporate-certs', 'env-files', 'llm-provider'].includes(step.id))
  const outcome = await runSteps(steps, ctx)
  if (!outcome.ok) process.exit(2)

  ensureMcpSharedDir(repoRoot)
  ensureOpencodeImage(ctx)
  const composeFile = FULLAPP_DEV_COMPOSE_FILE
  const upArgs = ['up', '-d']
  if (flags.rebuild) upArgs.push('--build')
  console.log('')
  console.log('── Starting the containerized stack (this builds the app image on the first run) ──')
  const up = runCompose(repoRoot, upArgs, { composeFile })
  if ((up.status ?? 1) !== 0) {
    console.error('❌ docker compose up failed — see above. TLS errors inside builds usually mean the corporate CA changed: re-run with --rebuild.')
    process.exit(up.status ?? 1)
  }

  const ports = resolveStackPorts(repoRoot)
  const urls = stackUrls(ports)
  console.log(color.dim('  Startup order: infra healthy -> app serving -> MCP -> OpenCode -> end-to-end wiring check.'))
  const infraOk = await waitForHealthyServices(repoRoot, composeFile, ['postgres', 'redis', 'meilisearch'], { log: console.log })
  if (!infraOk.ok) process.exit(1)
  console.log(color.dim('  First boot runs migrations + seed inside the app container — expect several minutes.'))
  if (!(await waitForHttp(urls.app, { label: `app ${urls.app}`, timeoutMs: 30 * 60 * 1000 }))) process.exit(1)
  const mcpOk = await waitForHttp(urls.mcpHealth, { label: 'MCP /health' })
  const opencodeOk = await waitForHttp(urls.opencodeHealth, { label: 'OpenCode /global/health' })
  if (mcpOk && opencodeOk) {
    await waitForHttp(urls.opencodeMcpStatus, {
      label: 'OpenCode <-> MCP wiring',
      timeoutMs: 2 * 60 * 1000,
      validate: (body) => body.includes('connected'),
    })
  }
  console.log('')
  console.log(color.bold(color.green('Stack is up.')))
  const superEmail = readEnvValue(path.join(repoRoot, '.env'), 'OM_INIT_SUPERADMIN_EMAIL')?.trim() || 'superadmin@acme.com'
  const superPassword = readEnvValue(path.join(repoRoot, '.env'), 'OM_INIT_SUPERADMIN_PASSWORD')?.trim() || 'secret'
  console.log(`  App:      ${color.cyan(urls.app)}  ${color.dim(`(sign in: ${superEmail} / ${superPassword})`)}`)
  console.log(`  OpenCode: ${color.cyan(`http://127.0.0.1:${ports.opencode}`)}`)
  console.log(color.dim('  Manage it with the stop / status / logs subcommands.'))
}

async function commandStop(flags) {
  const mode = resolveMode(flags.mode)
  if (flags.volumes && !flags.yes) {
    console.error('❌ --volumes DELETES all database/search data. Re-run with --yes to confirm.')
    process.exit(1)
  }
  if (mode === 'docker') {
    const down = runCompose(repoRoot, ['down', ...(flags.volumes ? ['--volumes'] : [])], { composeFile: FULLAPP_DEV_COMPOSE_FILE })
    process.exit(down.status ?? 1)
  }
  await stopDetached(repoRoot)
  if (!flags.keepInfra) {
    const docker = detectDocker()
    if (docker.ok) {
      const status = infraDown(repoRoot, { volumes: flags.volumes })
      if (status === 0) console.log(flags.volumes ? '✅ Infra containers stopped and volumes deleted.' : '✅ Infra containers stopped (data preserved).')
      process.exit(status)
    }
  }
  console.log('ℹ️ Infra containers left running (--keep-infra or no docker). Foreground `yarn dev` sessions stop with Ctrl+C.')
}

async function commandStatus(flags) {
  const mode = resolveMode(flags.mode)
  const status = await collectStatus(repoRoot, {
    runCompose: (root, args, opts) => runCompose(root, args, { ...opts, composeFile: mode === 'docker' ? FULLAPP_DEV_COMPOSE_FILE : undefined }),
  })
  printStatus(status)
}

async function commandDoctor(flags) {
  const company = await loadCompanyConfig(repoRoot)
  const runState = readRunState(repoRoot)
  const stackRunning = Boolean(runState && isPidAlive(runState.pid))
  const mode = resolveMode(flags?.mode)
  const checks = await runDoctor(repoRoot, { company, stackRunning, includeContainerProbe: true, mode })
  const ok = printDoctorReport(checks, { company })
  process.exit(ok ? 0 : 2)
}

async function commandReset(flags) {
  const mode = resolveMode(flags.mode)
  console.log('Reset stops the stack, removes containers + volumes (ALL LOCAL DATA), and clears starter state.')
  const confirmed = flags.yes || (await confirm('Continue?', flags))
  if (!confirmed) {
    console.log('Aborted.')
    return
  }
  // Kept env files can disagree with the recreated database (a stale
  // POSTGRES_PASSWORD / DATABASE_URL from a previous volume), but they also
  // hold the pasted LLM provider API key — so removal stays an explicit
  // opt-in and --yes alone never deletes them.
  const removeEnvFiles = flags.yes
    ? false
    : await confirm('Also remove the generated env files (.env, apps/mercato/.env)? They are regenerated with dev defaults on the next run, but the saved LLM API key goes with them.', flags)
  await stopDetached(repoRoot)
  const docker = detectDocker()
  if (docker.ok) {
    runCompose(repoRoot, ['down', '--volumes'], { composeFile: mode === 'docker' ? FULLAPP_DEV_COMPOSE_FILE : undefined })
  }
  fs.rmSync(path.join(repoRoot, STARTER_STATE_DIR), { recursive: true, force: true })
  if (removeEnvFiles) {
    fs.rmSync(path.join(repoRoot, '.env'), { force: true })
    fs.rmSync(path.join(repoRoot, 'apps', 'mercato', '.env'), { force: true })
    console.log('   removed .env and apps/mercato/.env')
  }
  console.log('✅ Reset complete. Run the starter again for a fresh environment.')
}

async function commandInfra(flags) {
  const docker = detectDocker()
  if (!docker.ok) {
    console.error(`❌ Docker is not available (${docker.reason}). Run the doctor subcommand for guided setup.`)
    process.exit(2)
  }
  if (flags.infraAction === 'down') {
    if (flags.volumes && !flags.yes) {
      console.error('❌ --volumes DELETES all database/search data. Re-run with --yes to confirm.')
      process.exit(1)
    }
    process.exit(infraDown(repoRoot, { volumes: flags.volumes }))
  }
  ensureMcpSharedDir(repoRoot)
  ensureOpencodeImage({ repoRoot, env: process.env, flags: { rebuild: flags.rebuild }, log: console.log })
  const status = infraUp(repoRoot, { profiles: flags.profiles })
  if (status === 0) {
    const ports = resolveStackPorts(repoRoot)
    console.log('')
    console.log(`✅ Infra containers are up (opencode :${ports.opencode}, postgres :${ports.postgres}, redis :${ports.redis}, meilisearch :${ports.meilisearch}).`)
    console.log('   Next: yarn dev (starts the app and the MCP server on this machine)')
  }
  process.exit(status)
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))
  switch (command) {
    case 'up':
      return commandUp(flags)
    case 'stop':
      return commandStop(flags)
    case 'status':
      return commandStatus(flags)
    case 'logs':
      return tailLogs(repoRoot, { follow: flags.follow })
    case 'doctor':
      return commandDoctor(flags)
    case 'reset':
      return commandReset(flags)
    case 'infra':
      return commandInfra(flags)
    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }
}

await main()
