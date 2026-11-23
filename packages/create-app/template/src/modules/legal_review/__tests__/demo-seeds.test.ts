/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const findOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({ User: class User {} }))
jest.mock('@open-mercato/documents/modules/documents/data/entities', () => ({
  Document: class Document {},
  DocumentContent: class DocumentContent {},
  DocumentReviewPlaybook: class DocumentReviewPlaybook {},
  DocumentReviewRule: class DocumentReviewRule {},
  DocumentReviewPlaybookReference: class DocumentReviewPlaybookReference {},
}))
jest.mock('../data/entities', () => ({ LegalMatter: class LegalMatter {} }))

import { seedLegalReviewDemoData } from '../lib/demoSeeds'
import {
  DEMO_AGREEMENTS,
  DEMO_GUIDANCE_DOCUMENTS,
  DEMO_MATTER,
  DEMO_REVIEW_RULES,
} from '../lib/demoContent'
import { LEGAL_AGREEMENT_TYPES, LEGAL_PAPER_SIDES } from '../data/validators'

const SCOPE = { tenantId: '0b4c1d2e-3f40-4a51-8b62-7c8d9e0f1a2b', organizationId: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d' }
const USER_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const NOW = new Date('2026-11-23T10:00:00.000Z')

type Created = { entity: string; data: Record<string, unknown> }

function buildEm() {
  const created: Created[] = []
  let sequence = 0
  const em = {
    create: jest.fn((entity: { name: string }, data: Record<string, unknown>) => {
      sequence += 1
      const row = { id: `id-${sequence}`, ...data }
      created.push({ entity: entity.name, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const byEntity = (name: string) => created.filter((entry) => entry.entity === name).map((entry) => entry.data)
  return { em: em as unknown as EntityManager, raw: em, byEntity }
}

function mockLookups(options: { playbookExists: boolean; userId: string | null }) {
  findOneWithDecryption.mockImplementation(async (_em: unknown, entity: { name: string }) => {
    if (entity.name === 'DocumentReviewPlaybook') return options.playbookExists ? { id: 'existing' } : null
    if (entity.name === 'User') return options.userId ? { id: options.userId } : null
    return null
  })
}

describe('legal review demo content', () => {
  it('uses unique rule codes and only supported severities', () => {
    const codes = DEMO_REVIEW_RULES.map((rule) => rule.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const rule of DEMO_REVIEW_RULES) {
      expect(['blocking', 'warning', 'info']).toContain(rule.severity)
      expect(rule.code.length).toBeLessThanOrEqual(64)
    }
  })

  it('links the matter to one of the sample agreements with valid enum values', () => {
    expect(DEMO_AGREEMENTS.map((agreement) => agreement.key)).toContain(DEMO_MATTER.documentKey)
    expect(LEGAL_AGREEMENT_TYPES).toContain(DEMO_MATTER.agreementType)
    expect(LEGAL_PAPER_SIDES).toContain(DEMO_MATTER.paper)
  })

  it('stores every sample document as HTML that opens with a heading', () => {
    for (const demo of [...DEMO_GUIDANCE_DOCUMENTS, ...DEMO_AGREEMENTS]) {
      expect(demo.html.startsWith('<h1>')).toBe(true)
      expect(demo.html).not.toMatch(/<script|on\w+=/i)
    }
  })

  it('points every guidance note at a playbook rule', () => {
    const codes = new Set(DEMO_REVIEW_RULES.map((rule) => rule.code))
    for (const note of DEMO_GUIDANCE_DOCUMENTS) {
      const referenced = note.html.match(/NDA-\d+\.\d+/)?.[0]
      expect(referenced && codes.has(referenced)).toBe(true)
    }
  })
})

describe('seedLegalReviewDemoData', () => {
  beforeEach(() => findOneWithDecryption.mockReset())

  it('creates the playbook, rules, documents, references and a requested matter', async () => {
    mockLookups({ playbookExists: false, userId: USER_ID })
    const { em, byEntity } = buildEm()

    const result = await seedLegalReviewDemoData(em, SCOPE, NOW)

    expect(result.seeded).toBe(true)
    expect(byEntity('DocumentReviewPlaybook')).toHaveLength(1)
    expect(byEntity('DocumentReviewRule')).toHaveLength(DEMO_REVIEW_RULES.length)
    const documentCount = DEMO_GUIDANCE_DOCUMENTS.length + DEMO_AGREEMENTS.length
    expect(byEntity('Document')).toHaveLength(documentCount)
    expect(byEntity('DocumentReviewPlaybookReference')).toHaveLength(DEMO_GUIDANCE_DOCUMENTS.length)

    for (const content of byEntity('DocumentContent')) {
      expect(content.contentHtml).toEqual(expect.stringContaining('<h1>'))
      expect(String(content.contentText)).not.toMatch(/<[a-z]/i)
      expect(String(content.contentText).length).toBeGreaterThan(0)
    }
    for (const document of byEntity('Document')) {
      expect(document).toMatchObject({ ...SCOPE, ownerUserId: USER_ID })
    }

    const [matter] = byEntity('LegalMatter')
    expect(matter).toMatchObject({
      ...SCOPE,
      documentId: result.documentIds[DEMO_MATTER.documentKey],
      reference: DEMO_MATTER.reference,
      stage: 'requested',
      assigneeUserId: USER_ID,
    })
    expect((matter.dueAt as Date).getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('does nothing when the playbook already exists', async () => {
    mockLookups({ playbookExists: true, userId: USER_ID })
    const { em, raw } = buildEm()

    const result = await seedLegalReviewDemoData(em, SCOPE, NOW)

    expect(result.seeded).toBe(false)
    expect(raw.create).not.toHaveBeenCalled()
  })

  it('seeds only the playbook and rules when the organization has no users', async () => {
    mockLookups({ playbookExists: false, userId: null })
    const { em, byEntity } = buildEm()

    const result = await seedLegalReviewDemoData(em, SCOPE, NOW)

    expect(result).toMatchObject({ seeded: true, matterId: null })
    expect(byEntity('DocumentReviewRule')).toHaveLength(DEMO_REVIEW_RULES.length)
    expect(byEntity('Document')).toHaveLength(0)
    expect(byEntity('LegalMatter')).toHaveLength(0)
  })
})
