import type {
  AiResolvedAttachmentPart,
  AiUiPart,
  AiChatRequestContext,
  AttachmentSource,
} from '../attachment-bridge-types'
import {
  definePromptTemplate,
  type PromptSection,
  type PromptSectionName,
  type PromptTemplate,
} from '../prompt-composition-types'

describe('AiResolvedAttachmentPart', () => {
  it('accepts each of the four source values', () => {
    const sources: AttachmentSource[] = ['bytes', 'signed-url', 'text', 'metadata-only']
    const parts: AiResolvedAttachmentPart[] = sources.map((source) => ({
      attachmentId: `att_${source}`,
      fileName: `file_${source}.bin`,
      mediaType: 'application/octet-stream',
      source,
    }))
    expect(parts.map((part) => part.source)).toEqual([
      'bytes',
      'signed-url',
      'text',
      'metadata-only',
    ])
  })

  it('allows textContent on text-like sources', () => {
    const part: AiResolvedAttachmentPart = {
      attachmentId: 'att_1',
      fileName: 'notes.md',
      mediaType: 'text/markdown',
      source: 'text',
      textContent: '# Notes\nExtracted contents',
    }
    expect(part.textContent).toContain('Notes')
  })

  it('allows short-lived signed-url sources', () => {
    const part: AiResolvedAttachmentPart = {
      attachmentId: 'att_2',
      fileName: 'invoice.pdf',
      mediaType: 'application/pdf',
      source: 'signed-url',
      url: 'https://example.test/signed/invoice.pdf?token=abc',
    }
    expect(part.url).toContain('signed')
  })

  it('allows inline bytes sources', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const part: AiResolvedAttachmentPart = {
      attachmentId: 'att_3',
      fileName: 'photo.jpg',
      mediaType: 'image/jpeg',
      source: 'bytes',
      data: bytes,
    }
    expect(part.data).toBe(bytes)
  })

  it('permits minimal metadata-only construction (optional fields truly optional)', () => {
    const part: AiResolvedAttachmentPart = {
      attachmentId: 'att_4',
      fileName: 'mystery.bin',
      mediaType: 'application/octet-stream',
      source: 'metadata-only',
    }
    expect(part.textContent).toBeUndefined()
    expect(part.url).toBeUndefined()
    expect(part.data).toBeUndefined()
  })
})

describe('AiUiPart', () => {
  it('structural shape (componentId + props)', () => {
    const part: AiUiPart = {
      componentId: 'mutation-preview-card',
      props: { actionId: 'act_1', summary: 'Update deal stage' },
    }
    expect(part.componentId).toBe('mutation-preview-card')
    expect(part.props).toHaveProperty('actionId', 'act_1')
  })
})

describe('AiChatRequestContext', () => {
  it('accepts fully-populated tenant/user context', () => {
    const ctx: AiChatRequestContext = {
      tenantId: 't_1',
      organizationId: 'o_1',
      userId: 'u_1',
      features: ['catalog.products.view', 'customers.people.view'],
      isSuperAdmin: false,
    }
    expect(ctx.features).toHaveLength(2)
    expect(ctx.isSuperAdmin).toBe(false)
  })

  it('tolerates null tenantId and organizationId (super-admin bootstrap)', () => {
    const ctx: AiChatRequestContext = {
      tenantId: null,
      organizationId: null,
      userId: 'u_root',
      features: [],
      isSuperAdmin: true,
    }
    expect(ctx.tenantId).toBeNull()
    expect(ctx.organizationId).toBeNull()
    expect(ctx.isSuperAdmin).toBe(true)
  })
})

describe('PromptSection / PromptTemplate', () => {
  it('PromptSectionName covers every named section from spec §8 plus overrides', () => {
    const names: PromptSectionName[] = [
      'role',
      'scope',
      'data',
      'tools',
      'attachments',
      'mutationPolicy',
      'responseStyle',
      'overrides',
    ]
    const sections: PromptSection[] = names.map((name, index) => ({
      name,
      content: `content for ${name}`,
      order: index,
    }))
    expect(sections).toHaveLength(8)
    expect(sections.map((section) => section.name)).toEqual(names)
  })

  it('PromptSection.order is optional', () => {
    const section: PromptSection = {
      name: 'role',
      content: 'You are the workspace assistant.',
    }
    expect(section.order).toBeUndefined()
  })

  it('definePromptTemplate is an identity builder', () => {
    const template: PromptTemplate = {
      id: 'ai_assistant.workspace_baseline',
      sections: [
        { name: 'role', content: 'role body', order: 0 },
        { name: 'scope', content: 'scope body', order: 1 },
      ],
    }
    const built = definePromptTemplate(template)
    expect(built).toBe(template)
    expect(built.id).toBe('ai_assistant.workspace_baseline')
  })

  it('supports the spec §8 baseline blueprint (role/scope/data/tools/attachments/mutationPolicy/responseStyle)', () => {
    const template = definePromptTemplate({
      id: 'ai_assistant.baseline',
      sections: [
        { name: 'role', content: 'You are the Open Mercato workspace assistant.', order: 0 },
        { name: 'scope', content: 'Access only the current tenant and organization.', order: 1 },
        { name: 'data', content: 'Prefer aggregate read-model tools.', order: 2 },
        { name: 'tools', content: 'Use allowed tool packs only.', order: 3 },
        { name: 'attachments', content: 'Summarize images and PDFs explicitly.', order: 4 },
        { name: 'mutationPolicy', content: 'Never execute writes without confirmation.', order: 5 },
        { name: 'responseStyle', content: 'Concise, business-facing, action-oriented.', order: 6 },
      ],
    })
    const required: PromptSectionName[] = [
      'role',
      'scope',
      'data',
      'tools',
      'attachments',
      'mutationPolicy',
      'responseStyle',
    ]
    const present = new Set(template.sections.map((section) => section.name))
    for (const name of required) {
      expect(present.has(name)).toBe(true)
    }
    const sortedByOrder = [...template.sections].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    expect(sortedByOrder[0].name).toBe('role')
    expect(sortedByOrder[sortedByOrder.length - 1].name).toBe('responseStyle')
  })
})
