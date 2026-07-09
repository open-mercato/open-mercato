import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { randomUUID } from 'node:crypto'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { DocumentTemplate } from '../data/entities'

export type DefaultDocumentTemplateSeed = {
  name: string
  description: string
  bodyHtml: string
  contextSlots: { slot: string; entityType: string; required?: boolean }[]
}

export const DEFAULT_DOCUMENT_TEMPLATES: Array<DefaultDocumentTemplateSeed> = [
  {
    name: 'Offer letter',
    description: 'A proposal starter with customer and quote context.',
    bodyHtml: [
      '<h1>Offer for {{customer.name}}</h1>',
      '<p>{{customer.chip}}</p>',
      '<p>Thank you for the opportunity to prepare offer {{quote.number}}.</p>',
      '<p>Write your offer details here…</p>',
      '<p>Prepared on {{date}}</p>',
    ].join(''),
    contextSlots: [
      { slot: 'customer', entityType: 'customer-person', required: true },
      { slot: 'quote', entityType: 'quote', required: false },
    ],
  },
  {
    name: 'Meeting notes',
    description: 'A structured note template for meetings and follow-ups.',
    bodyHtml: [
      '<h1>Meeting notes — {{date}}</h1>',
      '<p>{{company.chip}}</p>',
      '<h2>Attendees</h2>',
      '<ul></ul>',
      '<h2>Agenda</h2>',
      '<ul></ul>',
      '<h2>Action items</h2>',
      '<ul></ul>',
    ].join(''),
    contextSlots: [
      { slot: 'company', entityType: 'customer-company', required: false },
    ],
  },
  {
    name: 'Deal summary',
    description: 'A concise deal snapshot with customer context.',
    bodyHtml: [
      '<h1>Deal summary: {{deal.title}}</h1>',
      '<p>{{deal.chip}}</p>',
      '<table><tbody>',
      '<tr><td>Status</td><td>{{deal.status}}</td></tr>',
      '<tr><td>Value</td><td>{{deal.value}} {{deal.valueCurrency}}</td></tr>',
      '<tr><td>Customer</td><td>{{customer.name}}</td></tr>',
      '</tbody></table>',
      '<h2>Notes</h2>',
      '<p></p>',
    ].join(''),
    contextSlots: [
      { slot: 'deal', entityType: 'deal', required: true },
      { slot: 'customer', entityType: 'customer-company', required: false },
    ],
  },
]

type SeedDocumentTemplatesScope = {
  tenantId: string
  organizationId: string
  createdByUserId?: string | null
}

function resolveLinkedUserId(link: UserRole | null): string | null {
  if (!link) return null
  return typeof link.user?.id === 'string' ? link.user.id : null
}

async function findUserIdForRole(
  em: EntityManager,
  scope: Pick<SeedDocumentTemplatesScope, 'tenantId' | 'organizationId'>,
  roleName: string,
): Promise<string | null> {
  const role = await em.findOne(Role, {
    tenantId: scope.tenantId,
    name: roleName,
    deletedAt: null,
  })
  if (!role) return null

  const link = await em.findOne(
    UserRole,
    {
      role,
      deletedAt: null,
      user: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
    } as FilterQuery<UserRole>,
    {
      populate: ['user'] as const,
      orderBy: { createdAt: 'ASC' },
    },
  )
  return resolveLinkedUserId(link)
}

async function resolveTemplateSeedCreatorUserId(
  em: EntityManager,
  scope: Pick<SeedDocumentTemplatesScope, 'tenantId' | 'organizationId'>,
): Promise<string> {
  const adminUserId = await findUserIdForRole(em, scope, 'admin')
  if (adminUserId) return adminUserId

  const superadminUserId = await findUserIdForRole(em, scope, 'superadmin')
  if (superadminUserId) return superadminUserId

  const user = await em.findOne(
    User,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'ASC' } },
  )
  if (user) return user.id

  throw new Error('[internal] documents template seeding requires an existing tenant user')
}

export async function seedDefaultDocumentTemplates(
  em: EntityManager,
  scope: SeedDocumentTemplatesScope,
): Promise<void> {
  const createdByUserId = scope.createdByUserId ?? await resolveTemplateSeedCreatorUserId(em, scope)
  let created = 0

  for (const seed of DEFAULT_DOCUMENT_TEMPLATES) {
    const existing = await em.findOne(DocumentTemplate, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      deletedAt: null,
    })
    if (existing) continue

    em.persist(em.create(DocumentTemplate, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      description: seed.description,
      bodyHtml: seed.bodyHtml,
      contextSlots: seed.contextSlots,
      createdByUserId,
      isActive: true,
    }))
    created += 1
  }

  if (created > 0) {
    await em.flush()
  }
}
