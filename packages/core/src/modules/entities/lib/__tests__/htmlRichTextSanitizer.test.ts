/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
import { CustomEntity, CustomFieldDef } from '../../data/entities'
import {
  sanitizeCustomFieldHtmlRichTextValuesServer,
  sanitizeHtmlRichTextServer,
} from '../htmlRichTextSanitizer'

function definition(input: {
  key: string
  kind?: string
  editor?: string
  organizationId?: string | null
  tenantId?: string | null
  updatedAt?: string
}) {
  return {
    key: input.key,
    kind: input.kind ?? 'text',
    organizationId: input.organizationId ?? null,
    tenantId: input.tenantId ?? null,
    updatedAt: new Date(input.updatedAt ?? '2026-04-11T00:00:00.000Z'),
    configJson: input.editor ? { editor: input.editor } : {},
  } as CustomFieldDef
}

function entity(input: {
  defaultEditor?: string | null
  organizationId?: string | null
  tenantId?: string | null
  updatedAt?: string
}) {
  return {
    defaultEditor: input.defaultEditor ?? null,
    organizationId: input.organizationId ?? null,
    tenantId: input.tenantId ?? null,
    updatedAt: new Date(input.updatedAt ?? '2026-04-11T00:00:00.000Z'),
  } as CustomEntity
}

describe('htmlRichTextSanitizer', () => {
  it('removes executable html and unsafe attributes on the server', () => {
    expect(
      sanitizeHtmlRichTextServer('<p onclick="alert(1)">Hi<script>alert(2)</script><img src=x onerror=alert(3)><a href="javascript:alert(4)" title="ok">link</a></p>'),
    ).toBe('<p>Hi<a title="ok">link</a></p>')
  })

  it('sanitizes only values whose definitions use html rich text', async () => {
    const em = {
      find: jest.fn(async (entityClass: unknown) => {
        if (entityClass === CustomFieldDef) {
          return [
            definition({ key: 'body', editor: 'htmlRichText' }),
            definition({ key: 'plain' }),
          ]
        }
        if (entityClass === CustomEntity) return []
        return []
      }),
    } as unknown as EntityManager

    await expect(
      sanitizeCustomFieldHtmlRichTextValuesServer(em, {
        entityId: 'example:record',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        values: {
          body: '<p>Safe</p><iframe srcdoc="<script>alert(1)</script>"></iframe>',
          plain: '<script>alert(2)</script>',
        },
      }),
    ).resolves.toEqual({
      body: '<p>Safe</p>',
      plain: '<script>alert(2)</script>',
    })
  })

  it('uses the entity default editor for multiline fields', async () => {
    const em = {
      find: jest.fn(async (entityClass: unknown) => {
        if (entityClass === CustomFieldDef) return [definition({ key: 'body', kind: 'multiline' })]
        if (entityClass === CustomEntity) return [entity({ defaultEditor: 'htmlRichText' })]
        return []
      }),
    } as unknown as EntityManager

    await expect(
      sanitizeCustomFieldHtmlRichTextValuesServer(em, {
        entityId: 'example:record',
        values: {
          body: '<div><svg><script>alert(1)</script></svg><strong>Safe</strong></div>',
        },
      }),
    ).resolves.toEqual({
      body: '<div><strong>Safe</strong></div>',
    })
  })
})
