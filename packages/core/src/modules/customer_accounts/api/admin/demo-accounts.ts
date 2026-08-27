import { NextResponse } from 'next/server'
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
 * Reports which of the `seedExamples` portal accounts actually exist in the
 * caller's organization. An installation initialized with `--no-examples`, or an
 * organization the examples were never seeded into, gets an empty list so the
 * admin UI can hide the demo-credentials sections entirely (#5669).
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
      deletedAt: null,
    } as any,
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )

  if (seededUsers.length === 0) {
    return NextResponse.json({ ok: true, items: [] })
  }

  const roleLinks = await findWithDecryption(
    em,
    CustomerUserRole,
    { user: { $in: seededUsers.map((user) => user.id) } as any, deletedAt: null } as any,
    { populate: ['role'] },
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )

  const rolesByUserId = new Map<string, Array<{ id: string; name: string; slug: string }>>()
  for (const link of roleLinks) {
    const linkUserId = (link.user as any)?.id ?? (link.user as unknown as string)
    const role = link.role as any
    if (!role) continue
    const entry = { id: role.id, name: role.name, slug: role.slug }
    const bucket = rolesByUserId.get(linkUserId)
    if (bucket) bucket.push(entry)
    else rolesByUserId.set(linkUserId, [entry])
  }

  const seenEmails = new Set<string>()
  const items: Array<{ email: string; password: string; roles: Array<{ id: string; name: string; slug: string }> }> = []
  for (const user of seededUsers) {
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
    'Returns the example-data portal accounts that exist in the caller’s organization, with the credentials the seeding hook created them with. Returns an empty list when example data was not seeded.',
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
