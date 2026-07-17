#!/usr/bin/env node
// Shared post-bootstrap install pipeline for the hybrid starter. The OS
// bootstraps (install.sh / install.ps1) guarantee git, Node 24, and corepack
// yarn before handing off here; this script only needs the Node stdlib.
//
// Usage: node starters/lib/install.mjs [--skip-db] [--skip-llm-prompt]
//        [--non-interactive] [--no-start]
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import { detectDocker, resolveRepoRoot, runStreamingSync } from './compose.mjs'
import { ensureEnvFiles } from './env-setup.mjs'
import { ensureLlmProvider } from './providers.mjs'
import { ensureMcpSharedDir, infraUp } from './infra.mjs'

const STEPS_TOTAL = 7

function stepHeader(index, title, expectation) {
  console.log('')
  console.log(`── STEP ${index}/${STEPS_TOTAL} — ${title}`)
  if (expectation) console.log(`   Expected: ${expectation}`)
}

function runYarn(commandArgs, repoRoot) {
  const status = runStreamingSync('yarn', commandArgs, { cwd: repoRoot })
  if (status !== 0) {
    console.error(`❌ yarn ${commandArgs.join(' ')} failed (exit ${status}). Fix the error above and re-run the installer — completed steps are skipped or idempotent.`)
    process.exit(status)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const skipDb = args.includes('--skip-db')
  const skipLlmPrompt = args.includes('--skip-llm-prompt')
  const nonInteractive = args.includes('--non-interactive')
  const noStart = args.includes('--no-start')
  const repoRoot = resolveRepoRoot()

  console.log('Open Mercato — hybrid dev environment installer')
  console.log(`Repo: ${repoRoot}`)

  const docker = detectDocker()
  if (!docker.ok) {
    console.error(`❌ Docker is not available (${docker.reason}).`)
    console.error('   The hybrid starter needs a container runtime for OpenCode + postgres/redis/meilisearch.')
    console.error('   Install Docker Desktop, Rancher Desktop, or a native engine with the compose v2 plugin, then re-run this installer.')
    process.exit(2)
  }

  stepHeader(1, 'Install dependencies (yarn install)', 'a few minutes on first run')
  runYarn(['install'], repoRoot)

  stepHeader(2, 'Build workspace packages', '1-3 minutes on first run, cached afterwards')
  runYarn(['build:packages'], repoRoot)

  stepHeader(3, 'Generate module artifacts', 'under a minute')
  runYarn(['generate'], repoRoot)

  stepHeader(4, 'Environment files (.env)', 'instant; secrets are generated once and never overwritten')
  ensureEnvFiles(repoRoot)

  stepHeader(5, 'AI provider (LLM API key)', 'waits for your input; have a provider API key ready')
  const providerResult = await ensureLlmProvider(path.join(repoRoot, '.env'), { skipPrompt: skipLlmPrompt, nonInteractive })
  if (providerResult === 'failed') process.exit(1)

  stepHeader(6, 'Start infra containers (opencode, postgres, redis, meilisearch)', 'first run builds the OpenCode image — several minutes')
  ensureMcpSharedDir(repoRoot)
  const infraStatus = infraUp(repoRoot)
  if (infraStatus !== 0) {
    console.error('❌ docker compose up failed — see the output above. Re-running this installer resumes from this step.')
    process.exit(infraStatus)
  }

  stepHeader(7, 'Initialize the database', 'migrations + seed data; a minute or two')
  if (skipDb) {
    console.log('Skipped (--skip-db). Run `yarn db:migrate && yarn initialize` before the first `yarn dev`.')
  } else {
    runYarn(['db:migrate'], repoRoot)
    runYarn(['initialize'], repoRoot)
  }

  console.log('')
  console.log('✅ Install complete.')
  console.log('   App:      http://localhost:3000  (after yarn dev)')
  console.log('   MCP:      http://localhost:3001/mcp  (started by yarn dev)')
  console.log('   OpenCode: http://localhost:4096  (container)')
  console.log('   Superadmin credentials: OM_INIT_SUPERADMIN_EMAIL / OM_INIT_SUPERADMIN_PASSWORD in .env')
  console.log('')

  if (noStart) {
    console.log('Start the stack with: yarn dev  (or starters/hybrid/start.sh)')
    return
  }

  let startNow = true
  if (!nonInteractive && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise((resolve) => rl.question('Start the dev stack now? [Y/n] ', resolve))
    rl.close()
    startNow = !/^n/i.test(answer.trim())
  }
  if (startNow) {
    const startScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'start.mjs')
    const status = runStreamingSync(process.execPath, [startScript], { cwd: repoRoot })
    process.exit(status)
  } else {
    console.log('Start later with: yarn dev  (or starters/hybrid/start.sh)')
  }
}

await main()
