import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { htmlToPlainText } from '@open-mercato/shared/lib/html/htmlToPlainText'
import { LegalMatter } from '../data/entities'
import {
  DEMO_AGREEMENTS,
  DEMO_GUIDANCE_DOCUMENTS,
  DEMO_MATTER,
  DEMO_PLAYBOOK,
  DEMO_REVIEW_RULES,
  type DemoDocument,
} from './demoContent'
import type { LegalReviewSeedScope } from './seeds'

const DAY_MS = 24 * 60 * 60 * 1000
const RULE_SORT_STEP = 10

export type LegalReviewDemoSeedResult = {
  seeded: boolean
  documentIds: Record<string, string>
  playbookId: string | null
  matterId: string | null
}

async function resolveDemoOwnerUserId(em: EntityManager, scope: LegalReviewSeedScope): Promise<string | null> {
  const { User } = await import('@open-mercato/core/modules/auth/data/entities')
  const user = await findOneWithDecryption(
    em,
    User,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
  return user?.id ?? null
}

async function createDemoDocument(
  em: EntityManager,
  scope: LegalReviewSeedScope,
  ownerUserId: string,
  demo: DemoDocument,
): Promise<string> {
  const { Document, DocumentContent } = await import('@open-mercato/documents/modules/documents/data/entities')
  const document = em.create(Document, {
    ...scope,
    title: demo.title,
    ownerUserId,
    createdByUserId: ownerUserId,
    isActive: true,
  })
  em.persist(document)
  await em.flush()
  em.persist(
    em.create(DocumentContent, {
      ...scope,
      documentId: document.id,
      contentHtml: demo.html,
      contentText: htmlToPlainText(demo.html).replace(/\s+/g, ' ').trim(),
      collaborationGeneration: 1,
    }),
  )
  return document.id
}

/**
 * Seeds the NDA review demo: a playbook with rules and guidance notes, four
 * sample agreements and one matter waiting for its review to start. Writes
 * rows directly, so no domain events fire and no agent run starts. Idempotent:
 * does nothing when the playbook already exists in the organization.
 */
export async function seedLegalReviewDemoData(
  em: EntityManager,
  scope: LegalReviewSeedScope,
  now: Date = new Date(),
): Promise<LegalReviewDemoSeedResult> {
  const { DocumentReviewPlaybook, DocumentReviewRule, DocumentReviewPlaybookReference } = await import(
    '@open-mercato/documents/modules/documents/data/entities'
  )
  const skipped: LegalReviewDemoSeedResult = { seeded: false, documentIds: {}, playbookId: null, matterId: null }
  const existing = await findOneWithDecryption(
    em,
    DocumentReviewPlaybook,
    { ...scope, code: DEMO_PLAYBOOK.code, deletedAt: null },
    undefined,
    scope,
  )
  if (existing) return skipped

  const playbook = em.create(DocumentReviewPlaybook, {
    ...scope,
    code: DEMO_PLAYBOOK.code,
    name: DEMO_PLAYBOOK.name,
    description: DEMO_PLAYBOOK.description,
    instructions: DEMO_PLAYBOOK.instructions,
    version: 1,
    isActive: true,
  })
  em.persist(playbook)
  await em.flush()

  DEMO_REVIEW_RULES.forEach((rule, index) => {
    em.persist(
      em.create(DocumentReviewRule, {
        ...scope,
        playbookId: playbook.id,
        code: rule.code,
        title: rule.title,
        topic: rule.topic,
        position: rule.position,
        preferredWording: rule.preferredWording,
        severity: rule.severity,
        sortOrder: (index + 1) * RULE_SORT_STEP,
        isActive: true,
      }),
    )
  })

  const ownerUserId = await resolveDemoOwnerUserId(em, scope)
  if (!ownerUserId) {
    await em.flush()
    return { seeded: true, documentIds: {}, playbookId: playbook.id, matterId: null }
  }

  const documentIds: Record<string, string> = {}
  for (const demo of [...DEMO_GUIDANCE_DOCUMENTS, ...DEMO_AGREEMENTS]) {
    documentIds[demo.key] = await createDemoDocument(em, scope, ownerUserId, demo)
  }

  DEMO_GUIDANCE_DOCUMENTS.forEach((guidance, index) => {
    em.persist(
      em.create(DocumentReviewPlaybookReference, {
        ...scope,
        playbookId: playbook.id,
        documentId: documentIds[guidance.key],
        sortOrder: index,
      }),
    )
  })

  const matter = em.create(LegalMatter, {
    ...scope,
    documentId: documentIds[DEMO_MATTER.documentKey],
    reference: DEMO_MATTER.reference,
    counterparty: DEMO_MATTER.counterparty,
    purpose: DEMO_MATTER.purpose,
    jurisdiction: DEMO_MATTER.jurisdiction,
    agreementType: DEMO_MATTER.agreementType,
    paper: DEMO_MATTER.paper,
    requestedByUserId: ownerUserId,
    assigneeUserId: ownerUserId,
    stage: 'requested',
    dueAt: new Date(now.getTime() + DEMO_MATTER.dueInDays * DAY_MS),
  })
  em.persist(matter)
  await em.flush()

  return { seeded: true, documentIds, playbookId: playbook.id, matterId: matter.id }
}
