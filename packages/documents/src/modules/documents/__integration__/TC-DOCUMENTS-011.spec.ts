import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectOperation, redoOk, undoByToken, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents', 'catalog', 'audit_logs'],
}

type TemplateItem = {
  id?: string
  name?: string
  bodyHtml?: string
  contextSlots?: Array<{ slot: string; entityType: string; required?: boolean }> | null
  updatedAt?: string
}
type TemplateList = { items?: TemplateItem[] }
type Mutation = { id?: string; updatedAt?: string }
type Preview = { contentHtml?: string; unresolvedTokens?: string[]; templateUpdatedAt?: string; previewDigest?: string }
type Instantiate = { id?: string; updatedAt?: string; links?: Array<{ id?: string }> }

async function createTemplate(
  request: APIRequestContext,
  token: string,
  input: { name: string; bodyHtml: string; contextSlots: Array<{ slot: string; entityType: string; required: boolean }> },
) {
  const response = await apiRequest(request, 'POST', '/api/documents/templates', {
    token,
    data: { ...input, description: 'TC-DOCUMENTS-011 fixture', isActive: true },
  })
  const body = await readJsonSafe<Mutation>(response)
  expect(response.status()).toBe(201)
  return { id: expectId(body?.id, 'template id'), updatedAt: expectId(body?.updatedAt, 'template updatedAt') }
}

async function deleteTemplate(
  request: APIRequestContext,
  token: string | null,
  template: { id: string; updatedAt: string } | null,
) {
  if (!token || !template) return
  await request.fetch('/api/documents/templates', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: template.updatedAt,
    },
    data: { id: template.id },
  }).catch(() => undefined)
}

async function deleteDocumentGraph(request: APIRequestContext, token: string | null, documentId: string | null) {
  if (!token || !documentId) return
  const linksResponse = await apiRequest(request, 'GET', `/api/documents/${documentId}/links`, { token }).catch(() => null)
  if (linksResponse) {
    const links = await readJsonSafe<{ items?: Array<{ id?: string; updatedAt?: string }> }>(linksResponse)
    for (const link of links?.items ?? []) {
      if (!link.id) continue
      await request.fetch(`/api/documents/${documentId}/links/${link.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(link.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: link.updatedAt } : {}),
        },
      }).catch(() => undefined)
    }
  }
  await request.fetch(`/api/documents/${documentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined)
}

test.describe('TC-DOCUMENTS-011: deterministic preview and atomic template instantiation', () => {
  test('previews once, atomically creates the aggregate, and reuses identities across undo/redo', async ({ request }) => {
    const stamp = Date.now()
    const title = `TC-DOCUMENTS-011 Success ${stamp}`
    let token: string | null = null
    let productId: string | null = null
    let template: { id: string; updatedAt: string } | null = null
    let documentId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      productId = await createProductFixture(request, token, {
        title: `Documents product ${stamp}`,
        sku: `DOC11-${stamp}`,
      })
      template = await createTemplate(request, token, {
        name: `TC-DOCUMENTS-011 Product ${stamp}`,
        bodyHtml: '<h1>{{product.title}}</h1><p>{{product.chip}}</p><p>{{date}}</p>',
        contextSlots: [{ slot: 'product', entityType: 'product', required: true }],
      })

      const searchable = await apiRequest(
        request,
        'GET',
        `/api/documents/templates?search=${encodeURIComponent(`TC-DOCUMENTS-011 Product ${stamp}`)}`,
        { token },
      )
      const searchableBody = await readJsonSafe<TemplateList>(searchable)
      expect(searchable.status()).toBe(200)
      expect(searchableBody?.items?.some((item) => item.id === template?.id)).toBe(true)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/templates/${template.id}`,
        { token },
      )
      const detailBody = await readJsonSafe<{ id?: string; bodyHtml?: string }>(detailResponse)
      expect(detailResponse.status(), 'manager reads the full template body').toBe(200)
      expect(detailBody?.id).toBe(template.id)
      expect(detailBody?.bodyHtml).toContain('{{product.title}}')

      const renderInput = {
        templateUpdatedAt: template.updatedAt,
        title,
        locale: 'en-US',
        effectiveDate: '2026-01-02T00:30:00+14:00',
        slots: [{
          slot: 'product',
          entityType: 'product',
          entityId: productId,
          label: `Documents product ${stamp}`,
          href: `/backend/catalog/products/${productId}`,
          values: { title: `Documents product ${stamp}`, sku: `DOC11-${stamp}`, subtitle: null },
        }],
      }
      const previewResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/templates/${template.id}/preview`,
        { token, data: renderInput },
      )
      const preview = await readJsonSafe<Preview>(previewResponse)
      expect(previewResponse.status()).toBe(200)
      expect(preview?.unresolvedTokens).toEqual([])
      expect(preview?.contentHtml).toContain(`Documents product ${stamp}`)
      expect(preview?.contentHtml).toContain('1/1/2026')
      expect(preview?.previewDigest).toMatch(/^sha256:[0-9a-f]{64}$/)

      const staleDigest = await apiRequest(request, 'POST', '/api/documents/instantiate', {
        token,
        data: { ...renderInput, templateId: template.id, folderId: null, previewDigest: `sha256:${'0'.repeat(64)}` },
      })
      expect(staleDigest.status()).toBe(409)

      const instantiateResponse = await apiRequest(request, 'POST', '/api/documents/instantiate', {
        token,
        data: {
          ...renderInput,
          templateId: template.id,
          folderId: null,
          previewDigest: preview?.previewDigest,
        },
      })
      const instantiated = await readJsonSafe<Instantiate>(instantiateResponse)
      expect(instantiateResponse.status()).toBe(201)
      documentId = expectId(instantiated?.id, 'instantiated document id')
      expect(instantiated?.links).toHaveLength(1)
      const operation = expectOperation(instantiateResponse, 'instantiate document')

      const contentResponse = await apiRequest(request, 'GET', `/api/documents/${documentId}/content`, { token })
      const content = await readJsonSafe<{ contentHtml?: string; contentText?: string }>(contentResponse)
      expect(contentResponse.status()).toBe(200)
      expect(content?.contentHtml).toBe(preview?.contentHtml)
      expect(content?.contentText).toContain(`Documents product ${stamp}`)

      const initialContentId = await withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          'select id from document_contents where document_id = $1',
          [documentId],
        )
        return result.rows[0]?.id
      })
      expect(initialContentId).toBeTruthy()

      await undoOk(request, token, operation.undoToken, 'undo template instantiation')
      const undone = await withClient(async (client) => client.query<{ id: string; deleted_at: Date | null }>(
        'select id, deleted_at from document_contents where document_id = $1',
        [documentId],
      ))
      expect(undone.rows).toHaveLength(1)
      expect(undone.rows[0]?.id).toBe(initialContentId)
      expect(undone.rows[0]?.deleted_at).not.toBeNull()

      const redoOperation = await redoOk(request, token, operation.logId, 'redo template instantiation')
      const redone = await withClient(async (client) => client.query<{ id: string; deleted_at: Date | null }>(
        'select id, deleted_at from document_contents where document_id = $1',
        [documentId],
      ))
      expect(redone.rows).toHaveLength(1)
      expect(redone.rows[0]?.id).toBe(initialContentId)
      expect(redone.rows[0]?.deleted_at).toBeNull()

      const interveningEdit = await apiRequest(
        request,
        'PUT',
        `/api/documents/${documentId}/content`,
        { token, data: { contentHtml: '<p>Intervening edit</p>', contentText: 'Intervening edit' } },
      )
      expect(interveningEdit.status()).toBe(200)
      expect(redoOperation.undoToken).toBeTruthy()
      const staleUndo = await undoByToken(request, token, redoOperation.undoToken!)
      expect(staleUndo.ok(), 'instantiate undo must reject an intervening aggregate edit').toBe(false)

      const reverseResponse = await apiRequest(
        request,
        'GET',
        `/api/documents?entityType=product&entityId=${productId}&page=1&pageSize=20`,
        { token },
      )
      const reverse = await readJsonSafe<{ items?: Array<{ id?: string }> }>(reverseResponse)
      expect(reverseResponse.status()).toBe(200)
      expect(reverse?.items?.some((item) => item.id === documentId)).toBe(true)
    } finally {
      await deleteDocumentGraph(request, token, documentId)
      await deleteTemplate(request, token, template)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('deduplicates repeated targets, reports malformed tokens, and rolls back a forced late failure', async ({ request }) => {
    const stamp = Date.now()
    const duplicateTitle = `TC-DOCUMENTS-011 Duplicate output ${stamp}`
    const rollbackTitle = `TC-DOCUMENTS-011 Rollback ${stamp}`
    const triggerFunction = `tc_documents_011_fail_fn_${stamp}`
    const triggerName = `tc_documents_011_fail_trg_${stamp}`
    let token: string | null = null
    let productId: string | null = null
    let duplicateTemplate: { id: string; updatedAt: string } | null = null
    let rollbackTemplate: { id: string; updatedAt: string } | null = null
    let malformedTemplate: { id: string; updatedAt: string } | null = null
    let duplicateDocumentId: string | null = null
    let triggerInstalled = false

    try {
      token = await getAuthToken(request, 'admin')
      const scope = getTokenScope(token)
      productId = await createProductFixture(request, token, {
        title: `Rollback product ${stamp}`,
        sku: `DOC11-RB-${stamp}`,
      })
      duplicateTemplate = await createTemplate(request, token, {
        name: `TC-DOCUMENTS-011 Duplicate ${stamp}`,
        bodyHtml: '<p>{{primary.title}}</p><p>{{secondary.title}}</p>',
        contextSlots: [
          { slot: 'primary', entityType: 'product', required: true },
          { slot: 'secondary', entityType: 'product', required: true },
        ],
      })
      const duplicateRender = {
        templateUpdatedAt: duplicateTemplate.updatedAt,
        title: duplicateTitle,
        locale: 'en-US',
        effectiveDate: '2026-07-09T12:00:00Z',
        slots: ['primary', 'secondary'].map((slot) => ({
          slot,
          entityType: 'product',
          entityId: productId,
          label: `Rollback product ${stamp}`,
          href: `/backend/catalog/products/${productId}`,
          values: { title: `Rollback product ${stamp}` },
        })),
      }
      const previewResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/templates/${duplicateTemplate.id}/preview`,
        { token, data: duplicateRender },
      )
      const preview = await readJsonSafe<Preview>(previewResponse)
      expect(previewResponse.status()).toBe(200)

      const duplicateInstantiate = await apiRequest(request, 'POST', '/api/documents/instantiate', {
        token,
        data: {
          ...duplicateRender,
          templateId: duplicateTemplate.id,
          folderId: null,
          previewDigest: preview?.previewDigest,
        },
      })
      const duplicateResult = await readJsonSafe<Instantiate>(duplicateInstantiate)
      expect(duplicateInstantiate.status()).toBe(201)
      duplicateDocumentId = expectId(duplicateResult?.id, 'deduplicated document id')
      expect(duplicateResult?.links).toHaveLength(1)
      const duplicateContentResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${duplicateDocumentId}/content`,
        { token },
      )
      const duplicateContent = await readJsonSafe<{ contentHtml?: string }>(duplicateContentResponse)
      expect(duplicateContentResponse.status()).toBe(200)
      expect(duplicateContent?.contentHtml?.match(/Rollback product/g)).toHaveLength(2)

      rollbackTemplate = await createTemplate(request, token, {
        name: `TC-DOCUMENTS-011 Forced rollback ${stamp}`,
        bodyHtml: '<p>{{product.title}}</p>',
        contextSlots: [{ slot: 'product', entityType: 'product', required: true }],
      })
      const rollbackRender = {
        templateUpdatedAt: rollbackTemplate.updatedAt,
        title: rollbackTitle,
        locale: 'en-US',
        effectiveDate: '2026-07-09T12:00:00Z',
        slots: [{
          slot: 'product', entityType: 'product', entityId: productId,
          label: `Rollback product ${stamp}`,
          href: `/backend/catalog/products/${productId}`,
          values: { title: `Rollback product ${stamp}` },
        }],
      }
      const rollbackPreviewResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/templates/${rollbackTemplate.id}/preview`,
        { token, data: rollbackRender },
      )
      const rollbackPreview = await readJsonSafe<Preview>(rollbackPreviewResponse)
      expect(rollbackPreviewResponse.status()).toBe(200)

      await withClient(async (client) => {
        await client.query(`
          create function "${triggerFunction}"() returns trigger language plpgsql as $$
          begin
            if exists (select 1 from documents where id = new.document_id and title = '${rollbackTitle}') then
              raise exception 'TC-DOCUMENTS-011 forced link-phase failure';
            end if;
            return new;
          end $$
        `)
        await client.query(`
          create trigger "${triggerName}"
          before insert or update on document_entity_links
          for each row execute function "${triggerFunction}"()
        `)
      })
      triggerInstalled = true
      const failed = await apiRequest(request, 'POST', '/api/documents/instantiate', {
        token,
        data: {
          ...rollbackRender,
          templateId: rollbackTemplate.id,
          folderId: null,
          previewDigest: rollbackPreview?.previewDigest,
        },
      })
      expect(failed.status()).not.toBe(201)
      await withClient(async (client) => {
        await client.query(`drop trigger if exists "${triggerName}" on document_entity_links`)
        await client.query(`drop function if exists "${triggerFunction}"()`)
      })
      triggerInstalled = false
      const rollbackCounts = await withClient(async (client) => {
        const documents = await client.query<{ id: string }>(
          'select id from documents where tenant_id = $1 and organization_id = $2 and title = $3',
          [scope.tenantId, scope.organizationId, rollbackTitle],
        )
        const ids = documents.rows.map((row) => row.id)
        if (ids.length === 0) return { documents: 0, contents: 0, links: 0 }
        const contents = await client.query<{ count: string }>(
          'select count(*)::text as count from document_contents where document_id = any($1::uuid[])',
          [ids],
        )
        const links = await client.query<{ count: string }>(
          'select count(*)::text as count from document_entity_links where document_id = any($1::uuid[])',
          [ids],
        )
        return { documents: ids.length, contents: Number(contents.rows[0]?.count), links: Number(links.rows[0]?.count) }
      })
      expect(rollbackCounts).toEqual({ documents: 0, contents: 0, links: 0 })

      malformedTemplate = await createTemplate(request, token, {
        name: `TC-DOCUMENTS-011 Malformed ${stamp}`,
        bodyHtml: '<p>{{product.title</p>',
        contextSlots: [{ slot: 'product', entityType: 'product', required: true }],
      })
      const malformedInput = {
        templateUpdatedAt: malformedTemplate.updatedAt,
        title: `TC-DOCUMENTS-011 Malformed output ${stamp}`,
        locale: 'en-US',
        effectiveDate: '2026-07-09T12:00:00Z',
        slots: [{
          slot: 'product', entityType: 'product', entityId: productId,
          label: `Rollback product ${stamp}`,
          href: `/backend/catalog/products/${productId}`,
          values: { title: `Rollback product ${stamp}` },
        }],
      }
      const malformedPreviewResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/templates/${malformedTemplate.id}/preview`,
        { token, data: malformedInput },
      )
      const malformedPreview = await readJsonSafe<Preview>(malformedPreviewResponse)
      expect(malformedPreviewResponse.status()).toBe(200)
      expect(malformedPreview?.contentHtml).toBe('')
      expect(malformedPreview?.unresolvedTokens).toContain('invalid-token-syntax')
      const malformedInstantiate = await apiRequest(request, 'POST', '/api/documents/instantiate', {
        token,
        data: {
          ...malformedInput,
          templateId: malformedTemplate.id,
          folderId: null,
          previewDigest: malformedPreview?.previewDigest,
        },
      })
      expect(malformedInstantiate.status()).toBe(400)
    } finally {
      if (triggerInstalled) {
        await withClient(async (client) => {
          await client.query(`drop trigger if exists "${triggerName}" on document_entity_links`)
          await client.query(`drop function if exists "${triggerFunction}"()`)
        }).catch(() => undefined)
      }
      await deleteDocumentGraph(request, token, duplicateDocumentId)
      await deleteTemplate(request, token, malformedTemplate)
      await deleteTemplate(request, token, rollbackTemplate)
      await deleteTemplate(request, token, duplicateTemplate)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
