import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { executeCallApi } from '../activity-executor'
import type { WorkflowInstance } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: any, Entity: any, query: any) => em.findOne(Entity, query)),
  findWithDecryption: jest.fn(async (em: any, Entity: any, query: any, opts: any) => em.find(Entity, query, opts)),
}))

jest.setTimeout(20000)

// Mock fetch globally
const originalFetch = global.fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>

beforeEach(() => {
  global.fetch = mockFetch as any
  mockFetch.mockClear()
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('executeCallApi', () => {
  let mockEm: EntityManager
  let mockContainer: AwilixContainer
  let mockContext: any
  let createdApiKeys: any[] = []

  beforeEach(() => {
    createdApiKeys = []

    // Mock EntityManager
    mockEm = {
      create: jest.fn((Entity: any, data: any) => {
        const record = { ...data, id: `key-${createdApiKeys.length}` }
        createdApiKeys.push(record)
        return record
      }),
      persistAndFlush: jest.fn(),
      removeAndFlush: jest.fn(),
      findOne: jest.fn((Entity: any, query: any) => {
        const entityName = Entity?.name ?? ''
        if (entityName === 'WorkflowDefinition') {
          return Promise.resolve({
            id: 'def-123',
            tenantId: query.tenantId || 'tenant-456',
            createdBy: 'author-user-789',
          })
        }
        if (entityName === 'User') {
          return Promise.resolve({
            id: 'author-user-789',
            tenantId: query.tenantId || 'tenant-456',
            deletedAt: null,
          })
        }
        return Promise.resolve(null)
      }),
      find: jest.fn((Entity: any, query: any) => {
        const entityName = Entity?.name ?? ''
        if (entityName === 'UserRole') {
          return Promise.resolve([
            { id: 'ur-1', user: 'author-user-789', role: { id: 'role-author-uuid' } },
          ])
        }
        if (entityName === 'Role') {
          return Promise.resolve([
            { id: 'role-author-uuid', name: 'author-role', tenantId: query.tenantId || 'tenant-456' },
          ])
        }
        return Promise.resolve([])
      }),
    } as any

    // Mock Container
    mockContainer = {
      resolve: jest.fn((key: string) => {
        if (key === 'em') return mockEm
        return null
      }),
    } as any

    // Mock workflow context
    const workflowInstance: Partial<WorkflowInstance> = {
      id: 'wf-instance-123',
      definitionId: 'def-123',
      workflowId: 'checkout-demo',
      tenantId: 'tenant-456',
      organizationId: 'org-789',
      currentStepId: 'step-1',
      version: 1,
    }

    mockContext = {
      workflowInstance: workflowInstance as WorkflowInstance,
      workflowContext: {
        customer: { id: 'cust-123', name: 'John Doe' },
        cart: {
          id: 'cart-456',
          total: 120.50,
          currency: 'USD',
        },
      },
    }
  })

  it('should create one-time API key, make request, and delete key', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ id: 'order-123', status: 'created' }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'POST',
      body: { customerEntityId: '{{context.customer.id}}' },
    }

    // Act
    const result = await executeCallApi(mockEm, config, mockContext, mockContainer)

    // Assert
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: 'order-123', status: 'created' })

    // Verify API key was created
    expect(createdApiKeys.length).toBe(1)
    expect(createdApiKeys[0].name).toContain('__workflow_wf-instance-123__')
    expect(createdApiKeys[0].tenantId).toBe('tenant-456')
    expect(createdApiKeys[0].organizationId).toBe('org-789')

    // Verify API key was soft-deleted
    expect(createdApiKeys[0].deletedAt).toBeInstanceOf(Date)
    expect(mockEm.persistAndFlush).toHaveBeenCalled()
  })

  it('should interpolate workflow variables in request body', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ success: true }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'POST',
      body: {
        workflowInstanceId: '{{workflow.instanceId}}',
        tenantId: '{{workflow.tenantId}}',
        customerId: '{{context.customer.id}}',
      },
    }

    // Act
    await executeCallApi(mockEm, config, mockContext, mockContainer)

    // Assert
    const [url, options] = mockFetch.mock.calls[0] as any
    const sentBody = JSON.parse(options.body)

    expect(sentBody.workflowInstanceId).toBe('wf-instance-123')
    expect(sentBody.tenantId).toBe('tenant-456')
    expect(sentBody.customerId).toBe('cust-123')
  })

  it('should inject authentication and context headers', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ success: true }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'GET',
    }

    // Act
    await executeCallApi(mockEm, config, mockContext, mockContainer)

    // Assert
    const [url, options] = mockFetch.mock.calls[0] as any
    const headers = options.headers

    expect(headers['Authorization']).toMatch(/^apikey omk_/)
    expect(headers['X-Tenant-Id']).toBe('tenant-456')
    expect(headers['X-Organization-Id']).toBe('org-789')
    expect(headers['X-Workflow-Instance-Id']).toBe('wf-instance-123')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('should build full URL from relative path', async () => {
    // Arrange
    process.env.APP_URL = 'http://localhost:3000'

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ success: true }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'GET',
    }

    // Act
    await executeCallApi(mockEm, config, mockContext, mockContainer)

    // Assert
    const [url] = mockFetch.mock.calls[0] as any
    expect(url).toBe('http://localhost:3000/api/sales/orders')
  })

  it('should throw error for 401 Unauthorized (non-retriable)', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ error: 'Unauthorized' }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'POST',
    }

    // Act & Assert
    await expect(executeCallApi(mockEm, config, mockContext, mockContainer))
      .rejects.toThrow(/401/)
  })

  it('should throw error for 400 Bad Request (non-retriable)', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ error: 'Invalid payload' }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'POST',
      body: { invalid: 'data' },
    }

    // Act & Assert
    await expect(executeCallApi(mockEm, config, mockContext, mockContainer))
      .rejects.toThrow(/400/)
  })

  it('should throw error for 500 Internal Server Error (retriable)', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ error: 'Server error' }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'POST',
    }

    // Act & Assert
    await expect(executeCallApi(mockEm, config, mockContext, mockContainer))
      .rejects.toThrow(/500/)
  })

  it('should delete API key even if request fails', async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error('Network error'))

    const config = {
      endpoint: '/api/sales/orders',
      method: 'GET',
    }

    // Act & Assert
    await expect(executeCallApi(mockEm, config, mockContext, mockContainer))
      .rejects.toThrow('Network error')

    // Verify API key was still deleted
    expect(mockEm.removeAndFlush).toHaveBeenCalledWith(createdApiKeys[0])
  })

  it('should parse non-JSON response as text', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'Success',
      json: async () => {
        throw new Error('Not JSON')
      },
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'GET',
    }

    // Act
    const result = await executeCallApi(mockEm, config, mockContext, mockContainer)

    // Assert
    expect(result.body).toBe('Success')
  })

  it('should support custom headers', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ success: true }),
    } as any)

    const config = {
      endpoint: '/api/sales/orders',
      method: 'POST',
      headers: {
        'X-Custom-Header': 'custom-value',
        'X-Request-Id': 'req-123',
      },
    }

    // Act
    await executeCallApi(mockEm, config, mockContext, mockContainer)

    // Assert
    const [url, options] = mockFetch.mock.calls[0] as any
    const headers = options.headers

    expect(headers['X-Custom-Header']).toBe('custom-value')
    expect(headers['X-Request-Id']).toBe('req-123')
    // Standard headers should still be present
    expect(headers['Authorization']).toMatch(/^apikey omk_/)
    expect(headers['X-Tenant-Id']).toBe('tenant-456')
  })

  it('should throw error if endpoint is missing', async () => {
    // Arrange
    const config = {
      method: 'GET',
    }

    // Act & Assert
    await expect(executeCallApi(mockEm, config, mockContext, mockContainer))
      .rejects.toThrow('CALL_API requires "endpoint" field')
  })

  it('should support all HTTP methods', async () => {
    // Arrange
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

    for (const method of methods) {
      mockFetch.mockClear()
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ success: true }),
      } as any)

      const config = {
        endpoint: '/api/sales/orders',
        method,
      }

      // Act
      await executeCallApi(mockEm, config, mockContext, mockContainer)

      // Assert
      const [url, options] = mockFetch.mock.calls[0] as any
      expect(options.method).toBe(method)
    }
  }, 30000)

  it('should preserve array type when interpolating request body', async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ id: 'order-123', status: 'created' }),
    } as any)

    // Add orderLines to the workflow context
    mockContext.workflowContext.orderLines = [
      { quantity: 2, currencyCode: 'USD', lineDescription: 'Product A', unitPriceGross: 29.99 },
      { quantity: 1, currencyCode: 'USD', lineDescription: 'Product B', unitPriceGross: 49.99 },
    ]

    const config = {
      endpoint: '/api/sales/orders',
      method: 'POST',
      body: {
        customerEntityId: '{{context.customer.id}}',
        currencyCode: '{{context.cart.currency}}',
        lines: '{{context.orderLines}}', // Should preserve array type
      },
    }

    // Act
    await executeCallApi(mockEm, config, mockContext, mockContainer)

    // Assert
    const [url, options] = mockFetch.mock.calls[0] as any
    const sentBody = JSON.parse(options.body)

    // Verify lines is an actual array with proper structure
    expect(Array.isArray(sentBody.lines)).toBe(true)
    expect(sentBody.lines).toHaveLength(2)
    expect(sentBody.lines[0].quantity).toBe(2)
    expect(sentBody.lines[0].currencyCode).toBe('USD')
    expect(sentBody.lines[0].lineDescription).toBe('Product A')
    expect(sentBody.lines[1].quantity).toBe(1)

    // Verify other fields are still strings (single variable interpolations)
    expect(typeof sentBody.customerEntityId).toBe('string')
    expect(typeof sentBody.currencyCode).toBe('string')
  })

  describe('privilege escalation regression (no auto-admin)', () => {
    it('uses the workflow author roles, not an admin-by-name lookup', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({}),
      } as any)

      await executeCallApi(
        mockEm,
        { endpoint: '/api/sales/orders', method: 'GET' },
        mockContext,
        mockContainer,
      )

      expect(createdApiKeys.length).toBe(1)
      expect(createdApiKeys[0].rolesJson).toEqual(['role-author-uuid'])

      const findOneMock = mockEm.findOne as unknown as jest.Mock
      const roleLookups = findOneMock.mock.calls.filter(([Entity, query]: any[]) => {
        const name = (Entity as { name?: string } | undefined)?.name
        if (name !== 'Role') return false
        return typeof query === 'object' && query !== null && 'name' in (query as Record<string, unknown>)
      })
      expect(roleLookups).toHaveLength(0)
    })

    it('refuses to run when the workflow definition has no createdBy', async () => {
      ;(mockEm.findOne as unknown as jest.Mock).mockImplementation((Entity: any, query: any) => {
        const entityName = Entity?.name ?? ''
        if (entityName === 'WorkflowDefinition') {
          return Promise.resolve({
            id: 'def-123',
            tenantId: query.tenantId || 'tenant-456',
            createdBy: null,
          })
        }
        return Promise.resolve(null)
      })

      await expect(
        executeCallApi(
          mockEm,
          { endpoint: '/api/sales/orders', method: 'GET' },
          mockContext,
          mockContainer,
        ),
      ).rejects.toThrow(/Refusing to execute CALL_API/)

      expect(createdApiKeys.length).toBe(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('refuses to run when the author user has no active roles', async () => {
      ;(mockEm.find as unknown as jest.Mock).mockImplementation((Entity: any) => {
        const entityName = Entity?.name ?? ''
        if (entityName === 'UserRole') return Promise.resolve([])
        if (entityName === 'Role') return Promise.resolve([])
        return Promise.resolve([])
      })

      await expect(
        executeCallApi(
          mockEm,
          { endpoint: '/api/sales/orders', method: 'GET' },
          mockContext,
          mockContainer,
        ),
      ).rejects.toThrow(/Refusing to execute CALL_API/)

      expect(createdApiKeys.length).toBe(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('refuses to run when the workflow instance has no definitionId', async () => {
      mockContext.workflowInstance.definitionId = undefined

      await expect(
        executeCallApi(
          mockEm,
          { endpoint: '/api/sales/orders', method: 'GET' },
          mockContext,
          mockContainer,
        ),
      ).rejects.toThrow(/Refusing to execute CALL_API/)

      expect(createdApiKeys.length).toBe(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
