#!/usr/bin/env node
// Builds a benchmark dataset of companies through the application's own write path
// (POST /api/customers/companies), so field encryption, search tokens, entity indexes and custom
// field values are produced exactly as in production.
//
// Every record is a pure function of (plan seed, tenant key, org key, index): the dataset does not
// depend on concurrency or on how many times the script was resumed. Progress is appended to
// <state-dir>/<plan>/progress/<tenant>-<org>.log, so a rerun continues.
//
// No record is created twice (see lib/seeder.mjs). A create whose outcome is unknown (lost
// response, 5xx, interrupted run) is looked up by its generated domain. If the record is not there
// the index stays pending, the script exits with code 4, and the next run looks it up again; a
// still-missing index is created again only with --retry-unknown, once the earlier requests have
// certainly ended (e.g. the app was restarted). After writing to an organization the script checks
// that every expected domain occurs exactly once (--verify checks complete organizations too).
//
// Usage:
//   BENCH_EMAIL=... BENCH_PASSWORD=... node scripts/bench/dataset.mjs                    # smoke plan
//   node scripts/bench/dataset.mjs --plan scripts/bench/plans/companies-v1.json --concurrency 8
//   node scripts/bench/dataset.mjs --preview 5                                            # print records
//   node scripts/bench/dataset.mjs --verify                                               # check only
//
// BENCH_EMAIL / BENCH_PASSWORD: the `mercato init` admin; its organization is tenant "init" in plans.
// Tenants with "provision": "setup" are created with `mercato auth setup`; set BENCH_MERCATO_CLI when
// the CLI is not `yarn mercato` from the repo root (e.g. `node scripts/docker-exec.mjs mercato`).
// Their generated admin credentials are stored in the state file (under .mercato/, git-ignored),
// never printed.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { connect, queryValue, resolveDatabaseUrl } from './lib/db.mjs'
import { generateCompany } from './lib/generator.mjs'
import { login, requireCredentials } from './lib/http.mjs'
import { withDatasetLock } from './lib/state-lock.mjs'
import { parseProgress, seedCompanies, verifyIndexes } from './lib/seeder.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const { values } = parseArgs({
  options: {
    plan: { type: 'string', default: path.join(ROOT, 'scripts/bench/plans/companies-smoke.json') },
    base: { type: 'string', default: process.env.BENCH_BASE_URL ?? 'http://localhost:3000' },
    concurrency: { type: 'string', default: '8' },
    only: { type: 'string' },
    preview: { type: 'string' },
    state: { type: 'string', default: path.join(ROOT, '.mercato/bench/dataset-state.json') },
    'database-url': { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    'retry-unknown': { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

const plan = JSON.parse(readFileSync(values.plan, 'utf8'))

if (values.preview) {
  for (let i = 0; i < Number(values.preview); i++) console.log(JSON.stringify(generateCompany(plan, plan.tenants[0].key, plan.tenants[0].orgs[0].key, i)))
  process.exit(0)
}

const BASE = values.base.replace(/\/$/, '')
const CONCURRENCY = Number(values.concurrency)
const ONLY = values.only ? new Set(values.only.split(',')) : null
const statePath = path.resolve(values.state)
const progressDir = path.join(path.dirname(statePath), plan.name, 'progress')
mkdirSync(progressDir, { recursive: true })

function loadState() {
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { tenants: {} }
  if (state.plan && state.plan.name !== plan.name) {
    throw new Error(`${statePath} belongs to plan "${state.plan.name}"; pass --state <other file> for plan "${plan.name}"`)
  }
  state.plan = plan
  return state
}

function saveState(state) {
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

function mercato(args) {
  const [command, ...prefix] = (process.env.BENCH_MERCATO_CLI ?? 'yarn mercato').split(' ').filter(Boolean)
  const result = spawnSync(command, [...prefix, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`mercato ${args.slice(0, 2).join(' ')} failed (exit ${result.status}): ${(result.stderr || result.stdout || '').slice(-800)}`)
  return result.stdout
}

async function provision(state, credentials, db) {
  for (const tenant of plan.tenants) {
    const current = state.tenants[tenant.key] ?? { orgs: {} }
    if (tenant.provision === 'init' && !current.tenantId) {
      const { rows } = await db.query(`select id, tenant_id from organizations where deleted_at is null order by created_at limit 1`)
      if (!rows.length) throw new Error('No organization found; run `mercato init` first.')
      Object.assign(current, { tenantId: rows[0].tenant_id, adminEmail: credentials.email, usesBenchCredentials: true })
      current.orgs.main = rows[0].id
    }
    if (tenant.provision === 'setup' && !current.tenantId) {
      const email = `admin@${tenant.key}.bench.test`
      const password = `Bench-${randomBytes(12).toString('base64url')}-9a!`
      // `auth setup` reuses an existing user on rerun without changing its password, so set it
      // explicitly to keep reruns idempotent.
      const out = mercato(['auth', 'setup', '--orgName', tenant.orgName, '--email', email, '--password', password, '--roles', 'admin', '--json'])
      const payload = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop())
      mercato(['auth', 'set-password', '--email', email, '--password', password])
      Object.assign(current, { tenantId: payload.tenantId, adminEmail: email, adminPassword: password })
      current.orgs.main = payload.organizationId
      console.log(`provisioned tenant ${tenant.key}`)
    }
    if (tenant.provision === 'setup' && !current.prepared) {
      // The init tenant gets customer custom fields and dictionaries from `mercato init`;
      // setup tenants need these two commands to reach the same state.
      mercato(['entities', 'install', '--tenant', current.tenantId])
      mercato(['customers', 'seed-dictionaries', '--tenant', current.tenantId, '--org', current.orgs.main])
      current.prepared = true
    }
    state.tenants[tenant.key] = current
    saveState(state)

    for (const org of tenant.orgs) {
      if (current.orgs[org.key]) continue
      if (org.provision !== 'api') throw new Error(`org ${tenant.key}/${org.key} has no id and cannot be provisioned`)
      const token = await login(BASE, ...tenantCredentials(current, credentials))
      const res = await fetch(`${BASE}/api/directory/organizations`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ tenantId: current.tenantId, name: org.name, parentId: current.orgs.main }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.id) throw new Error(`creating org ${org.name} failed with HTTP ${res.status}`)
      current.orgs[org.key] = json.id
      saveState(state)
      console.log(`provisioned org ${tenant.key}/${org.key}`)
    }
  }
}

function tenantCredentials(tenantState, credentials) {
  return tenantState.usesBenchCredentials ? [credentials.email, credentials.password] : [tenantState.adminEmail, tenantState.adminPassword]
}

async function seedTarget(state, tenant, org, credentials) {
  const target = `${tenant.key}/${org.key}`
  const t = state.tenants[tenant.key]
  const progressPath = path.join(progressDir, `${tenant.key}-${org.key}.log`)
  const { done, pending } = parseProgress(existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : '')
  const todo = []
  for (let i = 0; i < org.companies; i++) if (!done.has(i) && !pending.has(i)) todo.push(i)
  const needsWork = todo.length > 0 || pending.size > 0
  if (!needsWork && !values.verify) {
    console.log(`${target}: complete (${org.companies})`)
    return { unresolved: [] }
  }

  let token = await login(BASE, ...tenantCredentials(t, credentials))
  const scope = { tenantId: t.tenantId, organizationId: t.orgs[org.key] }

  // Visits the organization's companies 100 at a time until `visit` returns false.
  async function listCompanies(sortDir, visit) {
    for (let page = 1; page <= 1000; page++) {
      const res = await fetch(`${BASE}/api/customers/companies?sortField=createdAt&sortDir=${sortDir}&pageSize=100&page=${page}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', cookie: `om_selected_org=${scope.organizationId}` },
      })
      if (!res.ok) throw new Error(`listing companies failed with HTTP ${res.status}`)
      const { items = [] } = await res.json()
      if (visit(items) === false || items.length < 100) return
    }
    throw new Error('more than 100,000 companies to list; cannot reconcile')
  }

  // Generated domains embed tenant, org and index, so a domain identifies the index of a record.
  async function findCommitted(candidates) {
    const byDomain = new Map([...candidates.keys()].map((i) => [generateCompany(plan, tenant.key, org.key, i).domain, i]))
    // Margin for clock skew between this machine and the database.
    const since = Math.min(...[...candidates.values()].map((at) => Date.parse(at))) - 60_000
    const found = new Set()
    await listCompanies('desc', (items) => {
      for (const item of items) {
        const index = byDomain.get(item.domain)
        if (index !== undefined) found.add(index)
      }
      const oldest = items.at(-1)?.created_at
      return !(oldest && Date.parse(oldest) < since)
    })
    return found
  }

  let result = { created: 0, recovered: 0, unresolved: [] }
  if (needsWork) result = await seed()

  const expected = new Map(Array.from({ length: org.companies }, (_, i) => [generateCompany(plan, tenant.key, org.key, i).domain, i]))
  const domains = []
  await listCompanies('asc', (items) => { for (const item of items) domains.push(item.domain) })
  const { duplicates, missing } = verifyIndexes(expected, domains, new Set(result.unresolved))
  if (duplicates.length || missing.length) {
    const sample = (list) => list.slice(0, 10).join(', ') + (list.length > 10 ? ', …' : '')
    throw new Error(`${target}: verification failed: ${duplicates.length} indexes with more than one record (${sample(duplicates.map((d) => `${d.index}×${d.count}`))}), ${missing.length} indexes with no record (${sample(missing)})`)
  }
  console.log(`${target}: verified, one record per index (${org.companies - result.unresolved.length} checked)`)
  return { unresolved: result.unresolved }

  async function seed() {
    let finished = 0
    const startedAt = Date.now()
    const progress = setInterval(() => {
      console.log(`${target}: ${done.size + finished}/${org.companies}  ${(finished / ((Date.now() - startedAt) / 1000)).toFixed(1)}/s`)
    }, 30_000)

    let result
    try {
      result = await seedCompanies({
        target,
        indexes: todo,
        pending,
        retryUnknown: values['retry-unknown'],
        concurrency: CONCURRENCY,
        send: async (i) => {
          const res = await fetch(`${BASE}/api/customers/companies`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ ...scope, ...generateCompany(plan, tenant.key, org.key, i) }),
          })
          // Read the body here: a connection that drops mid-body is an unknown outcome too.
          const text = await res.text()
          return { status: res.status, text: async () => text }
        },
        relogin: async () => { token = await login(BASE, ...tenantCredentials(t, credentials)) },
        findCommitted,
        log: {
          pending: (i, at) => appendFileSync(progressPath, `pending ${i} ${at}\n`),
          done: (i) => appendFileSync(progressPath, `${i}\n`),
        },
        onCreated: () => { finished++ },
      })
    } finally {
      clearInterval(progress)
    }
    const seconds = (Date.now() - startedAt) / 1000
    const recovered = result.recovered ? `; ${result.recovered} found already created after a lost response or an interrupted run` : ''
    const unknown = result.unresolved.length ? `; ${result.unresolved.length} with an unknown outcome left pending` : ''
    console.log(`${target}: created ${result.created} in ${seconds.toFixed(0)}s (${(result.created / seconds).toFixed(1)}/s)${recovered}${unknown}`)
    return result
  }
}

const credentials = requireCredentials(values)
const databaseUrl = resolveDatabaseUrl({ root: ROOT, explicit: values['database-url'] })
if (!databaseUrl) {
  console.error('No DATABASE_URL: set it in the environment or apps/mercato/.env, or pass --database-url.')
  process.exit(1)
}
await withDatasetLock(statePath, async () => {
const db = await connect(databaseUrl)
try {
  const state = loadState()
  await provision(state, credentials, db)
  const unresolved = []
  for (const tenant of plan.tenants) {
    for (const org of tenant.orgs) {
      if (ONLY && !ONLY.has(`${tenant.key}/${org.key}`)) continue
      const result = await seedTarget(state, tenant, org, credentials)
      for (const index of result.unresolved) unresolved.push(`${tenant.key}/${org.key}#${index}`)
    }
  }
  const total = await queryValue(db, `select count(*)::int from customer_entities where kind = 'company' and deleted_at is null`)
  if (unresolved.length) {
    console.error(`dataset ${plan.name} incomplete: the outcome of ${unresolved.length} creates is unknown (${unresolved.slice(0, 10).join(', ')}${unresolved.length > 10 ? ', …' : ''}).`)
    console.error('They stay pending. Rerun to look them up again; once the earlier requests have certainly ended (e.g. after restarting the app), rerun with --retry-unknown to create the ones still missing.')
    process.exitCode = 4
  } else {
    console.log(`dataset ${plan.name} complete; ${total} companies in the database`)
  }
} finally {
  await db.end()
}

})
