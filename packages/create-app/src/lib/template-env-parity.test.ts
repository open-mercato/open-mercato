import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// `apps/mercato/.env.example` ↔ `packages/create-app/template/.env.example` parity.
//
// Template Sync Checklist item 10 makes mirroring env vars a manual obligation:
// `scripts/template-sync.ts` syncs `src/**`, an explicit script list and a narrow
// dependency allowlist, and never reads `.env.example`. Nothing enforced the
// checklist, so the two files drifted by ~50 names — including
// `OM_ENABLE_ENTERPRISE_MODULES_AGENTS`, the flag `template/src/modules.ts`
// actually reads, which meant a scaffolded app documented no way to turn the
// Agent Orchestrator on.
//
// This test compares NAMES only, not bytes: AGENTS.md states the two files'
// comments legitimately diverge (monorepo-only paths, differing defaults), and a
// byte check would force them together wrongly.
//
// KNOWN_TEMPLATE_OMISSIONS / KNOWN_TEMPLATE_ONLY freeze the drift that already
// existed when this gate landed. They are a baseline, not an approval: the point
// is that no NEW name can drift. AGENTS.md rule 5 says to mirror your own change
// and leave pre-existing drift alone, so shrinking these lists is welcome but
// never required by this test. Adding to them is a deliberate act — say in the PR
// why the variable is genuinely one-sided.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const APP_ENV = path.join(REPO_ROOT, 'apps', 'mercato', '.env.example')
const TEMPLATE_ENV = path.join(REPO_ROOT, 'packages', 'create-app', 'template', '.env.example')

/** In the monorepo env but deliberately (or historically) absent from a scaffold. */
const KNOWN_TEMPLATE_OMISSIONS = new Set([
  'AUTO_SPAWN_SCHEDULER',
  'CURRENCY_RATE_FETCH_TIMEOUT_MS',
  'CUSTOMER_SESSION_TTL_DAYS',
  'MAX_CUSTOMER_SESSIONS_PER_USER',
  'MEILISEARCH_REQUEST_TIMEOUT_MS',
  'NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED',
  'NODE_OPTIONS',
  'OM_AGENT_HEALTH_PROBE_TTL_MS',
  'OM_ATTACHMENT_MAX_UPLOAD_MB',
  'OM_ATTACHMENT_TENANT_QUOTA_MB',
  'OM_AUTO_SPAWN_WORKERS_LAZY',
  'OM_AUTO_SPAWN_WORKERS_LAZY_MODE',
  'OM_DEFAULT_ATTACHMENT_OCR_ENABLED',
  'OM_OPTIMISTIC_LOCK',
  'RATE_LIMIT_2FA_VERIFY_DURATION',
  'RATE_LIMIT_2FA_VERIFY_POINTS',
  'RATE_LIMIT_ENABLED',
  'RATE_LIMIT_KEY_PREFIX',
  'RATE_LIMIT_LOGIN_BLOCK_DURATION',
  'RATE_LIMIT_LOGIN_DURATION',
  'RATE_LIMIT_LOGIN_IP_BLOCK_DURATION',
  'RATE_LIMIT_LOGIN_IP_DURATION',
  'RATE_LIMIT_LOGIN_IP_POINTS',
  'RATE_LIMIT_LOGIN_POINTS',
  'RATE_LIMIT_RESET_BLOCK_DURATION',
  'RATE_LIMIT_RESET_CONFIRM_DURATION',
  'RATE_LIMIT_RESET_CONFIRM_POINTS',
  'RATE_LIMIT_RESET_DURATION',
  'RATE_LIMIT_RESET_IP_BLOCK_DURATION',
  'RATE_LIMIT_RESET_IP_DURATION',
  'RATE_LIMIT_RESET_IP_POINTS',
  'RATE_LIMIT_RESET_POINTS',
  'RATE_LIMIT_RESET_VALIDATE_DURATION',
  'RATE_LIMIT_RESET_VALIDATE_POINTS',
  'RATE_LIMIT_STRATEGY',
  'REDIS_MAXMEMORY',
  'REQUESTY_API_KEY',
  'REQUESTY_BASE_URL',
])

/** In the template env but not the monorepo one. */
const KNOWN_TEMPLATE_ONLY = new Set([
  // Set by the standalone integration harness, which has no monorepo analogue.
  'OM_INTEGRATION_TEST',
  // Legacy spelling kept for scaffolds already using it; the monorepo documents
  // the `OM_DEFAULT_ATTACHMENT_OCR_ENABLED` form instead.
  'OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED',
])

/**
 * Every assignable name, whether the line is live or commented out. Both files
 * document most optional settings as commented examples, so a commented-only
 * name still counts as documented.
 */
function collectEnvNames(filePath: string): Set<string> {
  const names = new Set<string>()
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/)
    if (match) names.add(match[1])
  }
  return names
}

test('template .env.example documents every monorepo env var', () => {
  const appNames = collectEnvNames(APP_ENV)
  const templateNames = collectEnvNames(TEMPLATE_ENV)

  assert.ok(appNames.size > 100, `expected a populated monorepo env example, got ${appNames.size}`)

  const missing = [...appNames]
    .filter((name) => !templateNames.has(name) && !KNOWN_TEMPLATE_OMISSIONS.has(name))
    .sort()

  assert.deepEqual(
    missing,
    [],
    `These env vars exist in apps/mercato/.env.example but not in the create-app template.\n` +
      `Mirror them into packages/create-app/template/.env.example (Template Sync Checklist item 10),\n` +
      `or add them to KNOWN_TEMPLATE_OMISSIONS with a reason:\n  ${missing.join('\n  ')}`,
  )
})

test('template .env.example introduces no undocumented app-side gaps', () => {
  const appNames = collectEnvNames(APP_ENV)
  const templateNames = collectEnvNames(TEMPLATE_ENV)

  const templateOnly = [...templateNames]
    .filter((name) => !appNames.has(name) && !KNOWN_TEMPLATE_ONLY.has(name))
    .sort()

  assert.deepEqual(
    templateOnly,
    [],
    `These env vars exist only in the create-app template.\n` +
      `Document them in apps/mercato/.env.example too, or add them to KNOWN_TEMPLATE_ONLY:\n  ${templateOnly.join('\n  ')}`,
  )
})

test('the Agent Orchestrator flag the template reads is documented in both files', () => {
  // `template/src/modules.ts` gates `agent_orchestrator` on this flag. It was
  // absent from the template env for the module's whole life, so a scaffolded
  // app had no discoverable way to switch the orchestrator on.
  const modulesTs = fs.readFileSync(
    path.join(REPO_ROOT, 'packages', 'create-app', 'template', 'src', 'modules.ts'),
    'utf8',
  )
  assert.ok(
    modulesTs.includes('OM_ENABLE_ENTERPRISE_MODULES_AGENTS'),
    'template/src/modules.ts should still gate agent_orchestrator on the agents flag',
  )

  for (const envPath of [APP_ENV, TEMPLATE_ENV]) {
    assert.ok(
      collectEnvNames(envPath).has('OM_ENABLE_ENTERPRISE_MODULES_AGENTS'),
      `${path.relative(REPO_ROOT, envPath)} must document OM_ENABLE_ENTERPRISE_MODULES_AGENTS`,
    )
  }
})
