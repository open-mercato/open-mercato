import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Client } from 'pg'
import { z } from 'zod'
import { register } from 'tsx/esm/api'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

test('TC-AI-ACTIONS-SCOPE-012: transformed attachment scope uses real storage before confirmation writes', async ({ request }) => {
  test.slow()
  expect(['1', 'true']).toContain(process.env.OM_INTEGRATION_TEST)
  expect(process.env.DATABASE_URL).toBeTruthy()
  const unregister = register()
  try {
    const [
      { bootstrapFromAppRoot }, { createRequestContainer }, { prepareMutation },
      { seedAgentRegistryForTests, resetAgentRegistryForTests }, { loadAllModuleTools },
      { registerMcpTool, getToolRegistry, unregisterMcpTool }, { POST }, { getOrm }, { POST: cancel },
    ] = await Promise.all([
      import('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
      import('@open-mercato/shared/lib/di/container'),
      import('@open-mercato/ai-assistant/modules/ai_assistant/lib/prepare-mutation'),
      import('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry'),
      import('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader'),
      import('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry'),
      import('@open-mercato/ai-assistant/modules/ai_assistant/api/ai/actions/[id]/confirm/route'),
      import('@open-mercato/shared/lib/db/mikro'),
      import('@open-mercato/ai-assistant/modules/ai_assistant/api/ai/actions/[id]/cancel/route'),
    ])
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId, userId } = getTokenScope(token)
    const productId = await createProductFixture(request, token, { title: `IT scope ${randomUUID()}`, sku: `IT-SCOPE-${randomUUID()}` })
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    const attachmentIds = [randomUUID(), randomUUID(), randomUUID()]
    const actionIds: string[] = []
    const toolName = `it_attachment_${randomUUID().replaceAll('-', '')}`
    let container: Awaited<ReturnType<typeof createRequestContainer>> | undefined
    let restoreQueryLogger: (() => void) | undefined
    let queryCount = 0
    let handlerQueryCount = 0
    try {
      await client.connect()
      await bootstrapFromAppRoot(path.resolve(process.cwd(), 'apps/mercato'))
      container = await createRequestContainer()
      const queryLogger = (await getOrm()).config.getLogger()
      const originalLogQuery = queryLogger.logQuery
      queryLogger.logQuery = () => { queryCount += 1 }
      restoreQueryLogger = () => { queryLogger.logQuery = originalLogQuery }
      await loadAllModuleTools()
      const agent: AiAgentDefinition = {
        id: toolName, moduleId: 'ai_assistant', label: 'Attachment scope fixture', description: 'Disposable approval fixture',
        systemPrompt: 'Approval scope fixture', executionMode: 'chat', mutationPolicy: 'confirm-required',
        allowedTools: [toolName], requiredFeatures: ['ai_assistant.view'],
      }
      seedAgentRegistryForTests([agent])
      let effectiveAttachmentId = attachmentIds[0]
      const inputSchema = z.object({ referenceId: z.string().uuid(), title: z.string() }).transform((input) => ({
        ...input, attachmentIds: [effectiveAttachmentId],
      }))
      const tool: AiToolDefinition = {
        name: toolName, description: 'Disposable registered mutation', inputSchema, isMutation: true,
        requiredFeatures: ['catalog.products.manage'],
        loadBeforeRecord: async (input) => {
          const parsed = inputSchema.parse(input)
          const result = await client.query<{ title: string }>('select title from catalog_products where id = $1 and tenant_id = $2 and organization_id = $3', [productId, tenantId, organizationId])
          return { recordId: productId, entityType: 'catalog.product', recordVersion: null, before: { title: result.rows[0].title }, after: { title: parsed.title } }
        },
        handler: async (input) => {
          const parsed = inputSchema.parse(input)
          handlerQueryCount += 1
          await client.query('update catalog_products set title = $1 where id = $2 and tenant_id = $3 and organization_id = $4', [parsed.title, productId, tenantId, organizationId])
          return { recordId: productId }
        },
      }
      registerMcpTool(tool, { moduleId: 'ai_assistant' })
      for (const [index, id] of attachmentIds.entries()) {
        await client.query(`insert into attachments (id, entity_id, record_id, organization_id, tenant_id, partition_code, file_name, mime_type, file_size, storage_driver, storage_path, url, created_at)
          values ($1, 'catalog:product', $2, $3, $4, 'private', 'scope.txt', 'text/plain', 1, 'local', $5, '/scope.txt', now())`,
        [id, productId, index === 1 ? randomUUID() : organizationId, index === 2 ? randomUUID() : tenantId, `it-scope/${id}`])
      }
      const registeredTool = getToolRegistry().getTool(toolName)!
      for (const [index, attachmentId] of attachmentIds.entries()) {
        effectiveAttachmentId = attachmentIds[0]
        const original = (await client.query<{ title: string }>('select title from catalog_products where id = $1', [productId])).rows[0].title
        const title = `Approved ${randomUUID()}`
        const prepared = await prepareMutation({ agent, tool: registeredTool, toolCallArgs: { referenceId: attachmentIds[0], title } }, {
          tenantId, organizationId, userId, features: ['ai_assistant.view', 'catalog.products.manage'], isSuperAdmin: false, container,
        })
        actionIds.push(prepared.pendingAction.id)
        expect(prepared.pendingAction.attachmentIds).toEqual([attachmentIds[0]])
        effectiveAttachmentId = attachmentId
        queryCount = 0
        handlerQueryCount = 0
        const response = await POST(new Request(`http://localhost/api/ai_assistant/ai/actions/${prepared.pendingAction.id}/confirm`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
        }) as Parameters<typeof POST>[0], { params: Promise.resolve({ id: prepared.pendingAction.id }) })
        const body: { ok?: boolean; code?: string } = await response.json()
        console.info(JSON.stringify({ scenario: ['own attachment', 'foreign organization', 'foreign tenant'][index], sqlStatements: queryCount + handlerQueryCount }))
        expect(response.status, JSON.stringify(body)).toBe(index === 0 ? 200 : 403)
        expect(body).toMatchObject(index === 0 ? { ok: true } : { code: 'attachment_cross_tenant' })
        const stored = (await client.query<{ title: string }>('select title from catalog_products where id = $1', [productId])).rows[0].title
        expect(stored).toBe(index === 0 ? title : original)
        const state = (await client.query<{ status: string }>('select status from ai_pending_actions where id = $1', [prepared.pendingAction.id])).rows[0].status
        expect(state).toBe(index === 0 ? 'confirmed' : 'pending')
        if (index > 0) {
          const cancelled = await cancel(new Request(`http://localhost/api/ai_assistant/ai/actions/${prepared.pendingAction.id}/cancel`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
          }) as Parameters<typeof cancel>[0], { params: Promise.resolve({ id: prepared.pendingAction.id }) })
          expect(cancelled.status).toBe(200)
          effectiveAttachmentId = attachmentIds[0]
          const replacementContainer = await createRequestContainer()
          try {
            const replacement = await prepareMutation({ agent, tool: registeredTool, toolCallArgs: { referenceId: attachmentIds[0], title } }, {
              tenantId, organizationId, userId, features: ['ai_assistant.view', 'catalog.products.manage'], isSuperAdmin: false, container: replacementContainer,
            })
            actionIds.push(replacement.pendingAction.id)
            expect(replacement.reused).toBe(false)
            expect(replacement.pendingAction.id).not.toBe(prepared.pendingAction.id)
            expect(replacement.pendingAction.attachmentIds).toEqual([attachmentIds[0]])
          } finally {
            await replacementContainer.dispose()
          }
        }

      }
    } finally {
      restoreQueryLogger?.()
      unregisterMcpTool(toolName)
      resetAgentRegistryForTests()
      try {
        await client.query('delete from notifications where tenant_id = $1 and organization_id = $2 and source_entity_id = any($3::uuid[])', [tenantId, organizationId, actionIds])
        await client.query('delete from ai_pending_actions where id = any($1::uuid[])', [actionIds])
        await client.query('delete from attachments where id = any($1::uuid[])', [attachmentIds])
      } finally {
        await client.end()
        await container?.dispose()
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  } finally {
    unregister()
  }
})
