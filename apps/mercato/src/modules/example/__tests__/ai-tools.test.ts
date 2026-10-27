/** @jest-environment node */
/**
 * The `example` module's AI tool pack is a real MCP surface: whatever it declares
 * is what the agent runtime hands a model. These assertions pin the three things
 * that make the pack safe to copy — fail-closed scoping, ACL features that exist,
 * and read-only posture — plus the one behaviour that proves the todo tool is
 * wired to the module's own DI service rather than re-counting rows itself.
 */
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import aclFeatures from '../acl'
import aiTools, { customerPriorityInputSchema, requireToolScope } from '../ai-tools'
import { EXAMPLE_TODO_SUMMARY_SERVICE } from '../di'

const declaredFeatureIds = new Set(aclFeatures.map((feature) => feature.id))

function toolByName(name: string) {
  const tool = aiTools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`[internal] tool ${name} is not declared`)
  return tool
}

function fakeContext(overrides: {
  tenantId?: string | null
  organizationId?: string | null
  resolve?: (token: string) => unknown
}): McpToolContext {
  return {
    tenantId: 'tenantId' in overrides ? overrides.tenantId : 'tenant-1',
    organizationId: 'organizationId' in overrides ? overrides.organizationId : 'org-1',
    userId: 'user-1',
    userFeatures: [],
    isSuperAdmin: false,
    container: {
      resolve: overrides.resolve ?? (() => {
        throw new Error('[internal] unexpected container.resolve in this test')
      }),
    },
  } as unknown as McpToolContext
}

describe('example ai-tools pack', () => {
  it('declares exactly the two read-only tools the agent whitelists', () => {
    expect(aiTools.map((tool) => tool.name).sort()).toEqual([
      'example.get_customer_priority',
      'example.get_todo_summary',
    ])
    expect(aiTools.every((tool) => tool.isMutation === false)).toBe(true)
  })

  it('gates every tool on a feature that acl.ts actually declares', () => {
    const missing: string[] = []
    for (const tool of aiTools) {
      const required = tool.requiredFeatures ?? []
      expect(required.length).toBeGreaterThan(0)
      for (const feature of required) {
        if (!declaredFeatureIds.has(feature)) missing.push(`${tool.name} → ${feature}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('never declares tenant or organization as tool input', () => {
    // Asserts the DECLARED SHAPE, not a parse result. The earlier version fed only scope keys
    // to `safeParse`; for any tool with a required field that parse FAILS, the fallback made
    // `accepted` an empty object, and every assertion collapsed to
    // `expect(undefined).toBeUndefined()` — vacuously green. That left the pack's headline
    // safety property ("scope is never an input", stated in ai-tools.ts, the surface map and
    // the inventory) unpinned for the only tool with a non-empty schema.
    const scopeKeys = ['tenantId', 'organizationId', 'tenant_id', 'organization_id']
    for (const tool of aiTools) {
      const shape = (tool.inputSchema as unknown as { shape?: Record<string, unknown> }).shape
      expect(shape).toBeDefined()
      for (const key of scopeKeys) {
        expect(Object.keys(shape!)).not.toContain(key)
      }
    }
  })

  it('strips a scope key an attacker appends to an otherwise valid input', () => {
    // The complementary runtime half: a VALID input plus smuggled scope keys must not carry
    // them through. This is the case the old test could never reach.
    const scopeKeys = ['tenantId', 'organizationId', 'tenant_id', 'organization_id']
    for (const tool of aiTools) {
      const shape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape
      const validInput: Record<string, unknown> = {}
      for (const key of Object.keys(shape)) {
        // Every declared field in this pack is a uuid string; keep it honest if that changes.
        validInput[key] = '00000000-0000-4000-8000-000000000001'
      }
      const parsed = tool.inputSchema.safeParse({
        ...validInput,
        ...Object.fromEntries(scopeKeys.map((key) => [key, 'attacker-supplied'])),
      })
      expect(parsed.success).toBe(true)
      const accepted = (parsed as { data: Record<string, unknown> }).data
      for (const key of scopeKeys) {
        expect(accepted[key]).toBeUndefined()
      }
    }
  })

  describe('requireToolScope', () => {
    it('returns a trimmed scope when both halves are present', () => {
      expect(requireToolScope({ tenantId: ' t1 ', organizationId: ' o1 ' })).toEqual({
        tenantId: 't1',
        organizationId: 'o1',
      })
    })

    it.each([
      ['no tenant', { tenantId: null, organizationId: 'o1' }],
      ['no organization', { tenantId: 't1', organizationId: null }],
      ['blank tenant', { tenantId: '   ', organizationId: 'o1' }],
      ['blank organization', { tenantId: 't1', organizationId: '  ' }],
    ])('throws with %s', (_label, context) => {
      expect(() => requireToolScope(context)).toThrow(/tenant- and organization-scoped/)
    })
  })

  describe('example.get_todo_summary', () => {
    it('reads through the module DI service and projects only the summary fields', async () => {
      const read = jest.fn().mockResolvedValue({
        summary: { total: 4, done: 1, open: 3, tenantId: 'tenant-1', organizationId: 'org-1' },
        cacheHit: true,
      })
      const resolve = jest.fn().mockReturnValue({ read, invalidate: jest.fn() })

      const result = await toolByName('example.get_todo_summary').handler(
        {},
        fakeContext({ resolve }),
      )

      expect(resolve).toHaveBeenCalledWith(EXAMPLE_TODO_SUMMARY_SERVICE)
      expect(read).toHaveBeenCalledWith({ tenantId: 'tenant-1', organizationId: 'org-1' })
      expect(result).toEqual({ total: 4, done: 1, open: 3, cacheHit: true })
    })

    it('refuses to run before it touches the container when the scope is incomplete', async () => {
      const resolve = jest.fn()
      await expect(
        toolByName('example.get_todo_summary').handler({}, fakeContext({ tenantId: null, resolve })),
      ).rejects.toThrow(/tenant- and organization-scoped/)
      expect(resolve).not.toHaveBeenCalled()
    })
  })

  describe('example.get_customer_priority', () => {
    it('rejects a customer id that is not a uuid', () => {
      expect(customerPriorityInputSchema.safeParse({ customerId: 'not-a-uuid' }).success).toBe(false)
      expect(
        customerPriorityInputSchema.safeParse({ customerId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
          .success,
      ).toBe(true)
    })

    it('scopes the lookup by tenant and organization and returns null for an unscored customer', async () => {
      const findOne = jest.fn().mockResolvedValue(null)
      const resolve = jest.fn().mockReturnValue({ findOne })
      const customerId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

      const result = await toolByName('example.get_customer_priority').handler(
        { customerId },
        fakeContext({ resolve }),
      )

      expect(resolve).toHaveBeenCalledWith('em')
      expect(findOne.mock.calls[0][1]).toEqual({
        customerId,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        deletedAt: null,
      })
      expect(result).toEqual({ customerId, priority: null })
    })
  })
})
