import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentTemplate } from '../data/entities'

export type DefaultDocumentTemplateSeed = {
  name: string
  description: string
  bodyHtml: string
  contextSlots: { slot: string; entityType: string; required?: boolean }[]
}

/** Managed seed metadata is internal to the idempotent setup path. */
export type ManagedDocumentTemplateSeed = DefaultDocumentTemplateSeed & {
  seedKey: string
  legacyAdoptable?: boolean
}

const TEMPLATE_SEED_ACTOR_ID = '00000000-0000-4000-8000-000000000000'
const DEFAULT_NAME_SUFFIX = ' — Open Mercato default'

export const DEFAULT_DOCUMENT_TEMPLATES: Array<ManagedDocumentTemplateSeed> = [
  {
    seedKey: 'offer-letter',
    legacyAdoptable: true,
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
    seedKey: 'meeting-notes',
    legacyAdoptable: true,
    name: 'Meeting notes',
    description: 'A structured note template for meetings and follow-ups.',
    bodyHtml: [
      '<h1>Meeting notes — {{date}}</h1>',
      '<p>{{company.chip}}</p>',
      '<h2>Attendees</h2><ul></ul>',
      '<h2>Agenda</h2><ul></ul>',
      '<h2>Action items</h2><ul></ul>',
    ].join(''),
    contextSlots: [{ slot: 'company', entityType: 'customer-company', required: false }],
  },
  {
    seedKey: 'deal-summary',
    legacyAdoptable: true,
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
      '<h2>Notes</h2><p></p>',
    ].join(''),
    contextSlots: [
      { slot: 'deal', entityType: 'deal', required: true },
      { slot: 'customer', entityType: 'customer-company', required: false },
    ],
  },
  {
    seedKey: 'customer-meeting-brief',
    name: 'Customer meeting brief',
    description: 'Prepare a customer conversation with context and clear outcomes.',
    bodyHtml: [
      '<h1>Meeting brief — {{customer.name}}</h1>',
      '<p>{{customer.chip}}</p>',
      '<h2>Purpose</h2><p></p>',
      '<h2>Discussion points</h2><ul></ul>',
      '<h2>Desired outcomes</h2><ul></ul>',
      '<p>Prepared on {{date}}</p>',
    ].join(''),
    contextSlots: [{ slot: 'customer', entityType: 'customer-person', required: true }],
  },
  {
    seedKey: 'deal-proposal',
    name: 'Deal proposal',
    description: 'A proposal grounded in the current deal value and stage.',
    bodyHtml: [
      '<h1>Proposal — {{deal.title}}</h1>',
      '<p>{{deal.chip}}</p>',
      '<p>Status: {{deal.status}}</p>',
      '<p>Value: {{deal.value}} {{deal.valueCurrency}}</p>',
      '<h2>Objectives</h2><p></p>',
      '<h2>Approach</h2><p></p>',
      '<h2>Next steps</h2><ol></ol>',
    ].join(''),
    contextSlots: [{ slot: 'deal', entityType: 'deal', required: true }],
  },
  {
    seedKey: 'quote-cover-letter',
    name: 'Quote cover letter',
    description: 'A concise cover letter for a sales quote.',
    bodyHtml: [
      '<h1>Quote {{quote.number}}</h1>',
      '<p>{{quote.chip}}</p>',
      '<p>Thank you for considering this proposal.</p>',
      '<p>Total: {{quote.total}} {{quote.currency}}</p>',
      '<h2>Summary</h2><p></p>',
      '<p>Prepared on {{date}}</p>',
    ].join(''),
    contextSlots: [{ slot: 'quote', entityType: 'quote', required: true }],
  },
  {
    seedKey: 'order-handoff',
    name: 'Order handoff',
    description: 'Capture delivery context and ownership for an accepted order.',
    bodyHtml: [
      '<h1>Order handoff — {{order.number}}</h1>',
      '<p>{{order.chip}}</p>',
      '<p>Status: {{order.status}}</p>',
      '<p>Total: {{order.total}} {{order.currency}}</p>',
      '<h2>Delivery notes</h2><p></p>',
      '<h2>Owners and next steps</h2><ul></ul>',
    ].join(''),
    contextSlots: [{ slot: 'order', entityType: 'sales-order', required: true }],
  },
  {
    seedKey: 'product-brief',
    name: 'Product brief',
    description: 'A reusable product positioning and launch brief.',
    bodyHtml: [
      '<h1>Product brief — {{product.title}}</h1>',
      '<p>{{product.chip}}</p>',
      '<p>SKU: {{product.sku}}</p>',
      '<h2>Audience</h2><p></p>',
      '<h2>Value proposition</h2><p></p>',
      '<h2>Launch checklist</h2><ul></ul>',
    ].join(''),
    contextSlots: [{ slot: 'product', entityType: 'product', required: true }],
  },
]

type SeedDocumentTemplatesScope = {
  tenantId: string
  organizationId: string
  createdByUserId?: string | null
}

function slotsMatch(
  current: DocumentTemplate['contextSlots'],
  expected: DefaultDocumentTemplateSeed['contextSlots'],
): boolean {
  return JSON.stringify(current ?? []) === JSON.stringify(expected)
}

async function findBySeedKey(
  em: EntityManager,
  scope: SeedDocumentTemplatesScope,
  seedKey: string,
): Promise<DocumentTemplate | null> {
  return findOneWithDecryption(
    em,
    DocumentTemplate,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      seedKey,
    },
    { filters: false },
    scope,
  )
}

async function findActiveByName(
  em: EntityManager,
  scope: SeedDocumentTemplatesScope,
  name: string,
): Promise<DocumentTemplate | null> {
  return findOneWithDecryption(
    em,
    DocumentTemplate,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

export async function seedDefaultDocumentTemplates(
  em: EntityManager,
  scope: SeedDocumentTemplatesScope,
): Promise<void> {
  // Setup can share an EntityManager with other module initializers. Isolate
  // the unique-race recovery path so clearing a failed seed insert never drops
  // unrelated pending setup changes from the caller's unit of work.
  const seedEm = typeof em.fork === 'function' ? em.fork() : em
  const createdByUserId = scope.createdByUserId ?? TEMPLATE_SEED_ACTOR_ID

  for (const seed of DEFAULT_DOCUMENT_TEMPLATES) {
    if (await findBySeedKey(seedEm, scope, seed.seedKey)) continue

    const nameCollision = await findActiveByName(seedEm, scope, seed.name)
    if (
      seed.legacyAdoptable
      && nameCollision
      && nameCollision.description === seed.description
      && nameCollision.bodyHtml === seed.bodyHtml
      && slotsMatch(nameCollision.contextSlots, seed.contextSlots)
    ) {
      nameCollision.seedKey = seed.seedKey
      try {
        await seedEm.flush()
      } catch (error) {
        seedEm.clear()
        if (!await findBySeedKey(seedEm, scope, seed.seedKey)) throw error
      }
      continue
    }

    const template = seedEm.create(DocumentTemplate, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      seedKey: seed.seedKey,
      name: nameCollision ? `${seed.name}${DEFAULT_NAME_SUFFIX}` : seed.name,
      description: seed.description,
      bodyHtml: seed.bodyHtml,
      contextSlots: seed.contextSlots,
      createdByUserId,
      isActive: true,
    })
    seedEm.persist(template)
    try {
      await seedEm.flush()
    } catch (error) {
      seedEm.clear()
      if (!await findBySeedKey(seedEm, scope, seed.seedKey)) throw error
    }
  }
}
