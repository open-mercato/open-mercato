/**
 * Workflow Definition Customize / Reset-to-Code API Tests
 *
 * Verifies that the customize and reset-to-code endpoints emit the typed
 * `workflows.definition.customized` and `workflows.definition.reset_to_code`
 * events on success.
 */

import { NextRequest } from 'next/server'
import { POST as customizeDefinition } from '../definitions/[id]/customize/route'
import { POST as resetDefinitionToCode } from '../definitions/[id]/reset-to-code/route'
import { PUT as updateDefinition } from '../definitions/[id]/route'
import { WorkflowDefinition } from '../../data/entities'
import {
  clearCodeWorkflowRegistry,
  registerCodeWorkflows,
} from '../../lib/code-registry'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveOrganizationScopeFilter: jest.fn(() => ({ where: { organizationId: 'test-org' } })),
}))

describe('Workflow Definition customize/reset event emissions', () => {
  const tenantId = 'test-tenant-id'
  const organizationId = 'test-org-id'
  const userId = 'test-user-id'
  const codeWorkflowId = 'sales.order-approval'

  let mockEm: any
  let mockEventBus: { emitEvent: jest.Mock }
  let mockRbacService: { userHasAllFeatures: jest.Mock }
  let mockContainer: any

  beforeEach(() => {
    clearCodeWorkflowRegistry()

    registerCodeWorkflows([
      {
        workflowId: codeWorkflowId,
        workflowName: 'Order Approval',
        description: null,
        version: 1,
        enabled: true,
        metadata: null,
        moduleId: 'sales_module',
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' },
          ],
        },
      },
    ])

    mockEventBus = { emitEvent: jest.fn().mockResolvedValue(undefined) }

    mockRbacService = {
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
    }

    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((Entity: any, data: any) => {
        const created = new Entity()
        Object.assign(created, data)
        if (!created.id) created.id = 'def-new'
        return created
      }),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
    }

    mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'rbacService') return mockRbacService
        if (name === 'eventBus') return mockEventBus
        return null
      }),
    }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue(mockContainer)

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: organizationId,
    })

    const {
      resolveOrganizationScopeForRequest,
    } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: organizationId })
  })

  afterAll(() => {
    clearCodeWorkflowRegistry()
  })

  describe('POST /api/workflows/definitions/[id]/customize', () => {
    test('emits workflows.definition.customized after creating override', async () => {
      mockEm.findOne.mockResolvedValueOnce(null)

      const request = new NextRequest(
        `http://localhost/api/workflows/definitions/code:${codeWorkflowId}/customize`,
        { method: 'POST' },
      )
      const response = await customizeDefinition(request, {
        params: Promise.resolve({ id: `code:${codeWorkflowId}` }),
      })

      expect(response.status).toBe(200)
      expect(mockEventBus.emitEvent).toHaveBeenCalledTimes(1)
      const [eventName, payload, options] = mockEventBus.emitEvent.mock.calls[0]
      expect(eventName).toBe('workflows.definition.customized')
      expect(payload).toMatchObject({
        workflowId: codeWorkflowId,
        codeWorkflowId,
        tenantId,
        organizationId,
        userId,
      })
      expect(options).toMatchObject({ tenantId, organizationId, persistent: true })
    })

    test('emits workflows.definition.customized when reviving an existing override', async () => {
      const existing = new WorkflowDefinition()
      existing.id = 'def-existing'
      existing.workflowId = codeWorkflowId
      existing.tenantId = tenantId
      existing.organizationId = organizationId
      existing.codeWorkflowId = codeWorkflowId
      existing.deletedAt = null
      mockEm.findOne.mockResolvedValueOnce(existing)

      const request = new NextRequest(
        `http://localhost/api/workflows/definitions/code:${codeWorkflowId}/customize`,
        { method: 'POST' },
      )
      const response = await customizeDefinition(request, {
        params: Promise.resolve({ id: `code:${codeWorkflowId}` }),
      })

      expect(response.status).toBe(200)
      expect(mockEventBus.emitEvent).toHaveBeenCalledTimes(1)
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'workflows.definition.customized',
        expect.objectContaining({ id: 'def-existing', workflowId: codeWorkflowId }),
        expect.objectContaining({ tenantId, organizationId, persistent: true }),
      )
    })

    test('returns 404 and does not emit when code workflow is unknown', async () => {
      const request = new NextRequest(
        'http://localhost/api/workflows/definitions/code:unknown.id/customize',
        { method: 'POST' },
      )
      const response = await customizeDefinition(request, {
        params: Promise.resolve({ id: 'code:unknown.id' }),
      })

      expect(response.status).toBe(404)
      expect(mockEventBus.emitEvent).not.toHaveBeenCalled()
    })
  })

  describe('PUT /api/workflows/definitions/[id] (code: branch)', () => {
    test('emits workflows.definition.customized when PUTing a code: id', async () => {
      mockEm.findOne.mockResolvedValueOnce(null)

      const request = new NextRequest(
        `http://localhost/api/workflows/definitions/code:${codeWorkflowId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        },
      )
      const response = await updateDefinition(request, {
        params: Promise.resolve({ id: `code:${codeWorkflowId}` }),
      })

      expect(response.status).toBe(200)
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'workflows.definition.customized',
        expect.objectContaining({
          workflowId: codeWorkflowId,
          codeWorkflowId,
          tenantId,
          organizationId,
        }),
        expect.objectContaining({ tenantId, organizationId, persistent: true }),
      )
    })
  })

  describe('POST /api/workflows/definitions/[id]/reset-to-code', () => {
    test('emits workflows.definition.reset_to_code after deleting override', async () => {
      const existing = new WorkflowDefinition()
      existing.id = 'def-existing'
      existing.workflowId = codeWorkflowId
      existing.tenantId = tenantId
      existing.organizationId = organizationId
      existing.codeWorkflowId = codeWorkflowId
      mockEm.findOne.mockResolvedValueOnce(existing)

      const request = new NextRequest(
        'http://localhost/api/workflows/definitions/def-existing/reset-to-code',
        { method: 'POST' },
      )
      const response = await resetDefinitionToCode(request, {
        params: Promise.resolve({ id: 'def-existing' }),
      })

      expect(response.status).toBe(200)
      expect(mockEventBus.emitEvent).toHaveBeenCalledTimes(1)
      const [eventName, payload, options] = mockEventBus.emitEvent.mock.calls[0]
      expect(eventName).toBe('workflows.definition.reset_to_code')
      expect(payload).toMatchObject({
        id: 'def-existing',
        workflowId: codeWorkflowId,
        codeWorkflowId,
        tenantId,
        organizationId,
        userId,
      })
      expect(options).toMatchObject({ tenantId, organizationId, persistent: true })
    })

    test('does not emit reset_to_code when there are active instances', async () => {
      const existing = new WorkflowDefinition()
      existing.id = 'def-existing'
      existing.workflowId = codeWorkflowId
      existing.tenantId = tenantId
      existing.organizationId = organizationId
      existing.codeWorkflowId = codeWorkflowId
      mockEm.findOne.mockResolvedValueOnce(existing)
      mockEm.count.mockResolvedValueOnce(2)

      const request = new NextRequest(
        'http://localhost/api/workflows/definitions/def-existing/reset-to-code',
        { method: 'POST' },
      )
      const response = await resetDefinitionToCode(request, {
        params: Promise.resolve({ id: 'def-existing' }),
      })

      expect(response.status).toBe(409)
      expect(mockEventBus.emitEvent).not.toHaveBeenCalled()
      expect(mockEm.remove).not.toHaveBeenCalled()
    })

    test('does not throw when eventBus is not available', async () => {
      mockContainer.resolve = jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'rbacService') return mockRbacService
        return null
      })

      const existing = new WorkflowDefinition()
      existing.id = 'def-existing'
      existing.workflowId = codeWorkflowId
      existing.tenantId = tenantId
      existing.organizationId = organizationId
      existing.codeWorkflowId = codeWorkflowId
      mockEm.findOne.mockResolvedValueOnce(existing)

      const request = new NextRequest(
        'http://localhost/api/workflows/definitions/def-existing/reset-to-code',
        { method: 'POST' },
      )
      const response = await resetDefinitionToCode(request, {
        params: Promise.resolve({ id: 'def-existing' }),
      })

      expect(response.status).toBe(200)
    })
  })
})
