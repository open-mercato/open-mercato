#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { apiRequest, configureTls, login } from './lib/http.mjs'
import { generatePassword } from './lib/env.mjs'
import { loadTarget } from './lib/target.mjs'
import { ensureStateDir, readJsonFile, writeJsonFile } from './lib/state.mjs'
import { statePath } from './lib/paths.mjs'

const DEFAULT_TOTAL = 200
const DEFAULT_ADMINS = 20
const CONCURRENCY = 6

export function planUsers({ total = DEFAULT_TOTAL, admins = DEFAULT_ADMINS, domain = 'perf.local' } = {}) {
  return Array.from({ length: total }, (_, index) => {
    const number = String(index + 1).padStart(3, '0')
    return {
      email: `perf-user-${number}@${domain}`,
      name: `Perf User ${number}`,
      role: index < admins ? 'admin' : 'employee',
    }
  })
}

export function ownersFromUsers(users) {
  return {
    owners: users
      .filter((user) => user.userId)
      .map((user) => ({ userId: user.userId, staffMemberId: user.staffMemberId ?? null })),
  }
}

async function findUserIdByEmail(baseUrl, token, email) {
  const response = await apiRequest(baseUrl, `/api/auth/users?search=${encodeURIComponent(email)}&pageSize=5`, { token })
  const match = (response.data?.items ?? []).find((item) => String(item.email).toLowerCase() === email.toLowerCase())
  return match ? String(match.id) : null
}

async function createUser(baseUrl, token, organizationId, planned) {
  const password = planned.password ?? generatePassword()
  const response = await apiRequest(baseUrl, '/api/auth/users', {
    method: 'POST',
    token,
    json: { email: planned.email, name: planned.name, password, organizationId, roles: [planned.role] },
  })
  if (response.status === 201 || response.ok) return { userId: String(response.data.id), password }
  const existing = await findUserIdByEmail(baseUrl, token, planned.email)
  if (existing && planned.password) return { userId: existing, password: planned.password }
  if (existing) {
    const reset = await apiRequest(baseUrl, '/api/auth/users', { method: 'PUT', token, json: { id: existing, password } })
    if (reset.ok) return { userId: existing, password }
  }
  throw new Error(`[perf] creating ${planned.email} failed (HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 300)})`)
}

async function createStaffMember(baseUrl, token, scope, user) {
  const response = await apiRequest(baseUrl, '/api/staff/team-members', {
    method: 'POST',
    token,
    json: { displayName: user.name, userId: user.userId, isActive: true, organizationId: scope.organizationId, tenantId: scope.tenantId },
  })
  if (response.ok && response.data?.id) return String(response.data.id)
  throw new Error(`[perf] creating staff member for ${user.email} failed (HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 300)})`)
}

async function provisionOne(context, planned, existing) {
  const current = { ...planned, ...existing }
  if (!current.userId) {
    const created = await createUser(context.baseUrl, context.token, context.organizationId, current)
    current.userId = created.userId
    current.password = created.password
  }
  if (!current.staffMemberId) current.staffMemberId = await createStaffMember(context.baseUrl, context.token, context, current)
  return { email: current.email, password: current.password, role: current.role, userId: current.userId, staffMemberId: current.staffMemberId }
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length)
  let cursor = 0
  async function next() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
  return results
}

export async function provisionUsers({ baseUrl, tenant, total = DEFAULT_TOTAL, admins = DEFAULT_ADMINS, log = () => undefined }) {
  ensureStateDir()
  const usersPath = statePath('users.json')
  const previous = existsSync(usersPath) ? readJsonFile(usersPath) : []
  const previousByEmail = new Map(previous.map((user) => [user.email, user]))
  const token = await login(baseUrl, { email: tenant.adminEmail, password: tenant.adminPassword, tenantId: tenant.tenantId })
  const context = { baseUrl, token, organizationId: tenant.organizationId, tenantId: tenant.tenantId }
  const planned = planUsers({ total, admins })
  const finished = new Map(previous.filter((user) => user.userId && user.staffMemberId).map((user) => [user.email, user]))
  let completed = finished.size
  await runPool(planned, async (entry) => {
    if (finished.has(entry.email)) return finished.get(entry.email)
    const user = await provisionOne(context, entry, previousByEmail.get(entry.email) ?? {})
    finished.set(user.email, user)
    completed += 1
    if (completed % 20 === 0) {
      writeJsonFile(usersPath, planned.map((item) => finished.get(item.email)).filter(Boolean), 0o600)
      log(`provisioned ${completed}/${planned.length} users`)
    }
    return user
  }, CONCURRENCY)
  const users = planned.map((item) => finished.get(item.email))
  writeJsonFile(usersPath, users, 0o600)
  writeJsonFile(statePath('owners.json'), ownersFromUsers(users), 0o600)
  return { users: users.length, admins: users.filter((user) => user.role === 'admin').length }
}

async function main() {
  const target = loadTarget()
  configureTls(target)
  const tenant = readJsonFile(statePath('tenant.json'))
  const result = await provisionUsers({ baseUrl: target.CONTROL_BASE_URL, tenant, log: (line) => process.stdout.write(`${line}\n`) })
  process.stdout.write(`users.json and owners.json written: ${result.users} users (${result.admins} admins)\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
