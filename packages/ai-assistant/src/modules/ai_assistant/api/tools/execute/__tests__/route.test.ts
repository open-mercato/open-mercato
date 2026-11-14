import { NextRequest } from 'next/server'
import { z } from 'zod'
import { registerMcpTool, toolRegistry } from '../../../../lib/tool-registry'
import type { AiToolDefinition } from '../../../../lib/types'
import enTranslations from '../../../../i18n/en.json'
import { POST, metadata } from '../route'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const resolveMock = jest.fn()
const loadAllModuleToolsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: resolveMock }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string) => (enTranslations as Record<string, string>)[key] ?? key,
  }),
}))

jest.mock('../../../../lib/tool-loader', () => ({
  loadAllModuleTools: (...args: unknown[]) => loadAllModuleToolsMock(...args),
}))

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/ai_assistant/tools/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function registerTool(isMutation?: boolean) {
  const handler = jest.fn(async () => ({ recordId: 'record-1' }))
  const tool: AiToolDefinition = {
    name: 'test.direct_execution',
    description: 'Direct execution regression fixture',
    inputSchema: z.object({ title: z.string() }),
    requiredFeatures: ['test.records.manage'],
    ...(isMutation === undefined ? {} : { isMutation }),
    handler,
  }
  registerMcpTool(tool, { moduleId: 'test' })
  return handler
}

describe('POST /api/ai_assistant/tools/execute approval boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    toolRegistry.clear()
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    loadAclMock.mockResolvedValue({ features: ['test.records.manage'], isSuperAdmin: false })
    resolveMock.mockReturnValue({ loadAcl: loadAclMock })
    loadAllModuleToolsMock.mockResolvedValue(undefined)
  })

  afterEach(() => toolRegistry.clear())

  it.each([false, true])('refuses mutations before their handler runs (superadmin=%s)', async (isSuperAdmin) => {
    const handler = registerTool(true)
    loadAclMock.mockResolvedValue({ features: ['test.records.manage'], isSuperAdmin })

    const response = await POST(request({ toolName: 'test.direct_execution', args: { title: 'Changed' } }))

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: enTranslations['ai_assistant.errors.directMutationDenied'],
    })
  })

  it('ignores client-supplied approval and agent policy claims', async () => {
    const handler = registerTool(true)

    const response = await POST(request({
      toolName: 'test.direct_execution',
      args: { title: 'Changed', approved: true },
      approved: true,
      pendingActionId: 'forged-action',
      agent: 'test.assistant',
      mutationPolicy: 'destructive-confirm-required',
    }))

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
  })

  it('checks the registry populated by tool loading', async () => {
    const handler = jest.fn(async () => ({ written: true }))
    loadAllModuleToolsMock.mockImplementationOnce(async () => {
      const tool: AiToolDefinition = {
        name: 'test.loaded_mutation',
        description: 'Loaded mutation fixture',
        inputSchema: z.object({}),
        isMutation: true,
        handler,
      }
      registerMcpTool(tool, { moduleId: 'test' })
    })

    const response = await POST(request({ toolName: 'test.loaded_mutation' }))

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
  })

  it.each([false, undefined])('executes read tools and preserves the scoped context (isMutation=%s)', async (isMutation) => {
    const handler = registerTool(isMutation)

    const response = await POST(request({ toolName: 'test.direct_execution', args: { title: 'Read' } }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, result: { recordId: 'record-1' } })
    expect(handler).toHaveBeenCalledWith({ title: 'Read' }, expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      userFeatures: ['test.records.manage'],
      isSuperAdmin: false,
    }))
    expect(loadAclMock).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('keeps tool ACL checks on read execution', async () => {
    const handler = registerTool(false)
    loadAclMock.mockResolvedValue({ features: [], isSuperAdmin: false })

    const response = await POST(request({ toolName: 'test.direct_execution', args: { title: 'Read' } }))

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('Insufficient permissions') })
  })

  it('keeps tool schema validation on read execution', async () => {
    const handler = registerTool(false)

    const response = await POST(request({ toolName: 'test.direct_execution', args: { title: 123 } }))

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
  })

  it('keeps unknown-tool errors', async () => {
    const response = await POST(request({ toolName: 'test.unknown' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('not found') })
  })

  it('keeps endpoint authentication and declarative feature requirements', async () => {
    const handler = registerTool(true)
    authMock.mockResolvedValue(null)

    const response = await POST(request({ toolName: 'test.direct_execution', args: { title: 'Changed' } }))

    expect(handler).not.toHaveBeenCalled()
    expect(loadAllModuleToolsMock).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['ai_assistant.view'] })
  })
})
