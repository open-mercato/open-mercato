// Scriptable, non-interactive tenant provisioning for Open Mercato instances.
//
// This module backs the `mercato test:bootstrap-tenant` subcommand and is the
// scripting-friendly counterpart of the interactive `mercato init` flow. Both
// paths funnel through the same internal `setupInitialTenant` helper so a tenant
// minted here is functionally identical to one minted by `init`: a Tenant row,
// a primary Organization, the canonical role set + ACLs, an admin User, and one
// firing of every registered module's `onTenantCreated` lifecycle hook.
//
// Real-world callers include staging seeding loops, sales-engineering demo
// provisioning, customer-onboarding scripts, and disaster-recovery restores —
// any situation where staff need to mint a fresh tenant against an existing
// OM instance without sitting in front of the interactive prompts.
//
// Output contract: a single JSON object on stdout
//   { tenantId, organizationId, adminUserId, adminEmail }
// All diagnostic / banner output goes to stderr or is suppressed via
// `OM_CLI_QUIET=1` so consumers can pipe the JSON directly into `jq` or a
// downstream script.

import type { EntityManager } from '@mikro-orm/postgresql'

export type BootstrapTenantArgs = {
  slug: string
  orgName: string
  adminEmail: string
  adminPassword: string
  adminDisplayName?: string
  withExamples: boolean
}

export type BootstrapTenantResult = {
  tenantId: string
  organizationId: string
  adminUserId: string
  adminEmail: string
}

export class BootstrapTenantUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BootstrapTenantUsageError'
  }
}

export class TenantSlugExistsError extends Error {
  constructor(public readonly slug: string) {
    super(`TENANT_SLUG_EXISTS: a tenant or organization with slug "${slug}" already exists`)
    this.name = 'TenantSlugExistsError'
  }
}

export const BOOTSTRAP_TENANT_USAGE = `Usage: mercato test:bootstrap-tenant \\
  --slug <slug> \\
  --org-name <name> \\
  --admin-email <email> \\
  --admin-password <password> \\
  [--admin-display-name <name>] \\
  [--with-examples]`

/**
 * Parse raw CLI args into a validated `BootstrapTenantArgs` shape.
 *
 * Validation rules:
 *   - All four required flags must be provided as non-empty strings.
 *   - `--with-examples` is a boolean toggle (presence flips it true; default false).
 *   - `--admin-display-name` is optional; trimmed; absent or empty becomes undefined.
 *
 * Throws `BootstrapTenantUsageError` with a clear message on any validation
 * failure so the subcommand handler can surface it to stderr and exit non-zero
 * without printing a partial JSON payload.
 */
export function parseBootstrapTenantArgs(rest: string[]): BootstrapTenantArgs {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token) continue
    if (!token.startsWith('--')) continue
    const [rawKey, rawInline] = token.replace(/^--/, '').split('=')
    if (!rawKey) continue
    const key = normalizeArgKey(rawKey)
    if (rawInline !== undefined) {
      args[key] = rawInline
      continue
    }
    const next = rest[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next
      i++
    } else {
      args[key] = true
    }
  }

  const slug = readStringArg(args, 'slug')
  const orgName = readStringArg(args, 'org-name', 'orgName')
  const adminEmail = readStringArg(args, 'admin-email', 'adminEmail')
  const adminPassword = readStringArg(args, 'admin-password', 'adminPassword')
  const adminDisplayNameRaw = readStringArg(args, 'admin-display-name', 'adminDisplayName')
  const withExamplesRaw = args['with-examples'] ?? args['withExamples']

  const missing: string[] = []
  if (!slug) missing.push('--slug')
  if (!orgName) missing.push('--org-name')
  if (!adminEmail) missing.push('--admin-email')
  if (!adminPassword) missing.push('--admin-password')
  if (missing.length) {
    throw new BootstrapTenantUsageError(
      `Missing required flag(s): ${missing.join(', ')}\n\n${BOOTSTRAP_TENANT_USAGE}`,
    )
  }

  return {
    slug: slug!,
    orgName: orgName!,
    adminEmail: adminEmail!,
    adminPassword: adminPassword!,
    adminDisplayName: adminDisplayNameRaw && adminDisplayNameRaw.trim().length
      ? adminDisplayNameRaw.trim()
      : undefined,
    withExamples: withExamplesRaw === true || withExamplesRaw === 'true' || withExamplesRaw === '1',
  }
}

function normalizeArgKey(raw: string): string {
  // Both kebab-case (`--org-name`) and camelCase (`--orgName`) are accepted to
  // match the convention the rest of the CLI follows; downstream readers always
  // look up the kebab form first and fall back to camelCase.
  return raw
}

function readStringArg(
  args: Record<string, string | boolean>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Provision a fresh tenant + organization + admin user against the supplied
 * EntityManager. Wraps the existing `setupInitialTenant` helper used by
 * `mercato init` and `mercato auth setup` — same code path, no behavioural
 * forks, no test-only branches. The only differences relative to those callers
 * are:
 *
 *   - A pre-flight slug-collision check that fails loudly instead of merging
 *     into a foreign tenant.
 *   - A post-flight write of the supplied `slug` onto the freshly-minted
 *     organization, so downstream tooling has a stable scriptable handle that
 *     is independent of the human-friendly `orgName`.
 *   - Optional `--with-examples` mode that fires every module's `seedExamples`
 *     hook (mirroring the `mercato init` default-on behaviour, but opt-in here
 *     so prod customer-onboarding callers don't accidentally seed demo data).
 */
export async function bootstrapTenant(
  em: EntityManager,
  args: BootstrapTenantArgs,
  options: { container?: unknown } = {},
): Promise<BootstrapTenantResult> {
  const { Tenant, Organization } = await import(
    '@open-mercato/core/modules/directory/data/entities'
  )
  const { setupInitialTenant } = await import(
    '@open-mercato/core/modules/auth/lib/setup-app'
  )
  const { getCliModules } = await import('@open-mercato/shared/modules/registry')

  await assertSlugAvailable(em, args.slug, Tenant, Organization)

  const modules = getCliModules()
  const result = await setupInitialTenant(em, {
    orgName: args.orgName,
    primaryUser: {
      email: args.adminEmail,
      password: args.adminPassword,
      displayName: args.adminDisplayName ?? null,
      confirm: true,
    },
    includeDerivedUsers: false,
    modules,
  })

  // setupInitialTenant doesn't accept an org slug; persist it ourselves so the
  // slug callers passed in becomes a queryable identifier on the org row.
  await applyOrganizationSlug(em, Organization, result.organizationId, args.slug)

  if (args.withExamples) {
    const seedCtx = {
      em,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      container: options.container,
    }
    for (const mod of modules) {
      if (mod.setup?.seedExamples) {
        await mod.setup.seedExamples(seedCtx as any)
      }
    }
  }

  const adminSnapshot = pickAdminSnapshot(result.users, args.adminEmail)
  if (!adminSnapshot) {
    throw new Error(
      `BOOTSTRAP_TENANT_FAILED: setupInitialTenant returned no user record matching ${args.adminEmail}`,
    )
  }

  return {
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    adminUserId: String(adminSnapshot.user.id),
    adminEmail: args.adminEmail,
  }
}

async function assertSlugAvailable(
  em: EntityManager,
  slug: string,
  TenantCtor: any,
  OrganizationCtor: any,
): Promise<void> {
  // We treat `slug` as a global tenant-identifier from the caller's perspective.
  // The Tenant entity has no slug column; the Organization entity does (with a
  // unique-with-tenant constraint). Checking the Organization slug across all
  // tenants gives the caller-visible "is this slug taken?" semantics they
  // expect. We additionally guard against the synthesized Tenant.name pattern
  // (`${slug} Tenant`) so two callers passing the same slug in succession
  // collide deterministically even in the edge case where the org slug
  // collision check is somehow bypassed.
  const existingOrg = await (em as any).findOne(OrganizationCtor, { slug })
  if (existingOrg) {
    throw new TenantSlugExistsError(slug)
  }
  const synthesizedTenantName = `${slug} Tenant`
  const existingTenant = await (em as any).findOne(TenantCtor, {
    name: synthesizedTenantName,
  })
  if (existingTenant) {
    throw new TenantSlugExistsError(slug)
  }
}

async function applyOrganizationSlug(
  em: EntityManager,
  OrganizationCtor: any,
  organizationId: string,
  slug: string,
): Promise<void> {
  const org = await (em as any).findOne(OrganizationCtor, { id: organizationId })
  if (!org) return
  if (org.slug === slug) return
  org.slug = slug
  await (em as any).persist(org).flush()
}

function pickAdminSnapshot(
  users: Array<{ user: { id: string; email: string }; roles: string[]; created: boolean }>,
  adminEmail: string,
): { user: { id: string; email: string } } | undefined {
  // Prefer the canonical "primary" user — newly-created superadmin matching the
  // requested admin email. Fall back to any superadmin in the result set if the
  // primary lookup misses (e.g. an existing user was reused).
  const normalizedEmail = adminEmail.toLowerCase()
  const exact = users.find(
    (snapshot) =>
      snapshot.created &&
      snapshot.roles.includes('superadmin') &&
      typeof snapshot.user.email === 'string' &&
      snapshot.user.email.toLowerCase() === normalizedEmail,
  )
  if (exact) return exact
  const anySuperadmin = users.find((snapshot) => snapshot.roles.includes('superadmin'))
  return anySuperadmin
}

/**
 * Subcommand entry point — wired into the `mercato test:bootstrap-tenant`
 * registration in `mercato.ts`. Parses args, opens a request-scoped DI
 * container + EM, delegates to `bootstrapTenant`, and prints the result as a
 * single JSON line on stdout. Sets a non-zero `process.exitCode` on any
 * failure rather than throwing, so the parent CLI dispatcher reports the error
 * cleanly without a noisy stack trace.
 */
export async function runBootstrapTenant(rest: string[]): Promise<void> {
  let parsed: BootstrapTenantArgs
  try {
    parsed = parseBootstrapTenantArgs(rest)
  } catch (err) {
    if (err instanceof BootstrapTenantUsageError) {
      process.stderr.write(`${err.message}\n`)
      process.exitCode = 2
      return
    }
    throw err
  }

  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  try {
    const result = await bootstrapTenant(em, parsed, { container })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (err) {
    if (err instanceof TenantSlugExistsError) {
      process.stderr.write(`${err.message}\n`)
      process.exitCode = 1
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`BOOTSTRAP_TENANT_FAILED: ${message}\n`)
    process.exitCode = 1
  }
}
