import { NextResponse } from 'next/server'
import { compare as bcryptCompare } from 'bcryptjs'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUser, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { EXAMPLE_PORTAL_ACCOUNTS } from '@open-mercato/core/modules/customer_accounts/lib/exampleAccounts'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import type { EntityManager } from '@mikro-orm/postgresql'

const FEATURE = 'customer_accounts.view'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [FEATURE] },
}

/**
 * Reports which of the `seedExamples` portal accounts can actually be logged into
 * in the caller's organization. An installation initialized with `--no-examples`,
 * or an organization the examples were never seeded into, gets an empty list so
 * the admin UI can hide the demo-credentials sections entirely (#5669).
 *
 * The surfaces this feeds claim "these credentials work", so mere existence is not
 * enough: the lookup applies the same guards `api/login.ts` enforces (active,
 * email-verified, not soft-deleted) and the advertised password is compared
 * against the stored hash, so an account that was deactivated or whose password
 * was changed since seeding drops out instead of being advertised.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, [FEATURE], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  const em = container.resolve('em') as EntityManager

  // Emails are stored encrypted, so the seeded addresses are matched through the
  // deterministic lookup hash (both the current and the legacy candidate).
  const accountByHash = new Map<string, (typeof EXAMPLE_PORTAL_ACCOUNTS)[number]>()
  for (const account of EXAMPLE_PORTAL_ACCOUNTS) {
    for (const candidate of lookupHashCandidates(account.email)) {
      accountByHash.set(candidate, account)
    }
  }

  const seededUsers = await findWithDecryption(
    em,
    CustomerUser,
    {
      emailHash: { $in: Array.from(accountByHash.keys()) },
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      isActive: true,
      emailVerifiedAt: { $ne: null },
      deletedAt: null,
    } as any,
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )

  const loginableUsers: typeof seededUsers = []
  for (const user of seededUsers) {
    const account = accountByHash.get(user.emailHash as string)
    if (!account || !user.passwordHash) continue
    if (await bcryptCompare(account.password, user.passwordHash)) loginableUsers.push(user)
  }

  if (loginableUsers.length === 0) {
    return NextResponse.json({ ok: true, items: [] })
  }

  const roleLinks = await findWithDecryption(
    em,
    CustomerUserRole,
    { user: { $in: loginableUsers.map((user) => user.id) } as any, deletedAt: null } as any,
    { populate: ['role'] },
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )

  const rolesByUserId = new Map<string, Array<{ id: string; name: string; slug: string }>>()
  for (const link of roleLinks) {
    const role = link.role
    if (!role || role.deletedAt) continue
    const entry = { id: role.id, name: role.name, slug: role.slug }
    const bucket = rolesByUserId.get(link.user.id)
    if (bucket) bucket.push(entry)
    else rolesByUserId.set(link.user.id, [entry])
  }

  const seenEmails = new Set<string>()
  const items: Array<{ email: string; password: string; roles: Array<{ id: string; name: string; slug: string }> }> = []
  for (const user of loginableUsers) {
    const account = accountByHash.get(user.emailHash as string)
    if (!account || seenEmails.has(account.email)) continue
    seenEmails.add(account.email)
    items.push({
      email: account.email,
      password: account.password,
      roles: rolesByUserId.get(user.id) ?? [],
    })
  }

  // Keep the response ordered like the seed list so the admin table is stable.
  const orderByEmail = new Map(EXAMPLE_PORTAL_ACCOUNTS.map((account, index) => [account.email, index]))
  items.sort((a, b) => (orderByEmail.get(a.email) ?? 0) - (orderByEmail.get(b.email) ?? 0))

  return NextResponse.json({ ok: true, items })
}

const demoAccountSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  roles: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'List seeded demo portal accounts (admin)',
  description:
    'Returns the example-data portal accounts that exist in the caller’s organization and can still be logged into with the credentials the seeding hook created them with. Accounts that were deactivated, left unverified, soft-deleted, or had their password changed are omitted, as is every account when example data was not seeded.',
  tags: ['Customer Accounts Admin'],
  responses: [{
    status: 200,
    description: 'Seeded demo accounts present in the current organization',
    schema: z.object({ ok: z.literal(true), items: z.array(demoAccountSchema) }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Seeded demo portal accounts (admin)',
  methods: {
    GET: getMethodDoc,
  },
}
