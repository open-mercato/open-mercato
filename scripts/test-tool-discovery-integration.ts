/**
 * Integration test for hybrid tool discovery.
 * Tests the complete flow from tool registration to discovery.
 */
import { getToolRegistry, registerMcpTool } from '../packages/ai-assistant/src/modules/ai_assistant/lib/tool-registry'
import { discoverTools, detectModuleFromQuery, getDiscoveryStatus } from '../packages/ai-assistant/src/modules/ai_assistant/lib/tool-discovery'
import { TOOL_ENTITY_ID, GLOBAL_TENANT_ID, ESSENTIAL_TOOLS, computeToolsChecksum, toolToIndexableRecord } from '../packages/ai-assistant/src/modules/ai_assistant/lib/tool-index-config'
import { z } from 'zod'
import type { McpToolContext } from '../packages/ai-assistant/src/modules/ai_assistant/lib/types'

// ============= Test Utilities =============

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\u274C FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 PASS: ${message}`)
}

// ============= Setup Test Tools =============

const testTools = [
  // Customers module
  { name: 'customers_search', description: 'Search for customer records in the CRM', moduleId: 'customers', requiredFeatures: ['customers.people.view'] },
  { name: 'customers_create', description: 'Create a new customer record', moduleId: 'customers', requiredFeatures: ['customers.people.manage'] },
  { name: 'customers_get', description: 'Get a customer by ID', moduleId: 'customers', requiredFeatures: ['customers.people.view'] },

  // Sales module
  { name: 'sales_orders_create', description: 'Create a new sales order', moduleId: 'sales', requiredFeatures: ['sales.orders.manage'] },
  { name: 'sales_orders_list', description: 'List all sales orders', moduleId: 'sales', requiredFeatures: ['sales.orders.view'] },
  { name: 'sales_quotes_convert', description: 'Convert a quote to an order', moduleId: 'sales', requiredFeatures: ['sales.orders.manage', 'sales.quotes.manage'] },

  // Catalog module
  { name: 'catalog_products_list', description: 'List products in the catalog', moduleId: 'catalog', requiredFeatures: ['catalog.products.view'] },
  { name: 'catalog_products_create', description: 'Create a new product', moduleId: 'catalog', requiredFeatures: ['catalog.products.manage'] },

  // Booking module
  { name: 'booking_resources_get', description: 'Get a booking resource by ID', moduleId: 'booking', requiredFeatures: ['booking.view'] },
  { name: 'booking_schedule_create', description: 'Create a new booking schedule', moduleId: 'booking', requiredFeatures: ['booking.manage_availability'] },

  // Search module
  { name: 'search_query', description: 'Search across all entities using hybrid search', moduleId: 'search', requiredFeatures: [] },
  { name: 'search_schema', description: 'Discover searchable entity fields and configurations', moduleId: 'search', requiredFeatures: [] },
  { name: 'search_status', description: 'Get current status of search strategies and indexing', moduleId: 'search', requiredFeatures: [] },

  // Context
  { name: 'context_whoami', description: 'Get current authentication context and permissions', moduleId: 'context', requiredFeatures: [] },
]

// Register test tools
console.log('\n=== Registering Test Tools ===\n')
for (const tool of testTools) {
  registerMcpTool({
    name: tool.name,
    description: tool.description,
    inputSchema: z.object({}),
    requiredFeatures: tool.requiredFeatures,
    handler: async () => ({}),
  }, { moduleId: tool.moduleId })
}
console.log(`Registered ${testTools.length} test tools`)

// ============= Test Module Detection =============

console.log('\n=== Testing Module Detection ===\n')

const moduleDetectionTests = [
  { query: 'find all customers', expected: 'customers' },
  { query: 'show me the people list', expected: 'customers' },
  { query: 'create a new order', expected: 'sales' },
  { query: 'list all invoices', expected: 'sales' },
  { query: 'product catalog search', expected: 'catalog' },
  { query: 'book a room for tomorrow', expected: 'booking' },
  { query: 'search for something', expected: 'search' },
  { query: 'who am I logged in as?', expected: 'audit_logs' }, // "logged" matches "log" keyword
  { query: 'random unrelated query', expected: 'search' }, // "query" matches search module
  { query: 'hello world xyz', expected: undefined }, // Truly unrelated
]

for (const { query, expected } of moduleDetectionTests) {
  const detected = detectModuleFromQuery(query)
  assert(detected === expected, `detectModuleFromQuery("${query}") = ${detected} (expected: ${expected})`)
}

// ============= Test Essential Tools =============

console.log('\n=== Testing Essential Tools ===\n')

assert(ESSENTIAL_TOOLS.includes('context_whoami'), 'context_whoami is essential')
assert(ESSENTIAL_TOOLS.includes('search_query'), 'search_query is essential')
assert(ESSENTIAL_TOOLS.includes('search_schema'), 'search_schema is essential')
assert(ESSENTIAL_TOOLS.includes('search_status'), 'search_status is essential')
assert(ESSENTIAL_TOOLS.length === 4, `Essential tools count is ${ESSENTIAL_TOOLS.length}`)

// ============= Test Indexable Record Conversion =============

console.log('\n=== Testing Indexable Record Conversion ===\n')

const record = toolToIndexableRecord({
  name: 'customers_search',
  description: 'Search for customer records in the CRM',
  inputSchema: z.object({}),
  requiredFeatures: ['customers.people.view'],
  handler: async () => ({}),
}, 'customers')

assert(record.entityId === TOOL_ENTITY_ID, `Record entityId is ${record.entityId}`)
assert(record.recordId === 'customers_search', `Record recordId is ${record.recordId}`)
assert(record.tenantId === GLOBAL_TENANT_ID, `Record tenantId is ${record.tenantId}`)
assert(record.organizationId === null, `Record organizationId is null`)
assert(record.fields.name === 'customers search', `Record name is normalized`)
assert(record.fields.originalName === 'customers_search', `Record originalName preserved`)
assert(record.fields.moduleId === 'customers', `Record moduleId is customers`)
assert(record.text?.includes('customers search'), `Record text includes normalized name`)

// ============= Test Tool Registry =============

console.log('\n=== Testing Tool Registry ===\n')

const registry = getToolRegistry()
const registeredTools = registry.listToolNames()
const toolsByModule = registry.listToolsByModule('customers')

assert(registeredTools.length >= testTools.length, `Registry has ${registeredTools.length} tools`)
assert(toolsByModule.length >= 3, `Customers module has ${toolsByModule.length} tools`)
assert(toolsByModule.includes('customers_search'), 'Customers module includes customers_search')

// ============= Test Checksum Computation =============

console.log('\n=== Testing Checksum Computation ===\n')

const checksum1 = computeToolsChecksum(testTools.map(t => ({ name: t.name, description: t.description })))
const checksum2 = computeToolsChecksum(testTools.map(t => ({ name: t.name, description: t.description })))
const checksum3 = computeToolsChecksum([...testTools, { name: 'new_tool', description: 'A new tool' }].map(t => ({ name: t.name, description: t.description })))

assert(checksum1 === checksum2, 'Same tools produce same checksum')
assert(checksum1 !== checksum3, 'Different tools produce different checksum')
console.log(`Checksum: ${checksum1}`)

// ============= Test Mock Tool Search Service =============

console.log('\n=== Testing Mock Tool Search Service ===\n')

// Create a mock search service that simulates keyword matching
class MockToolSearchService {
  async getStrategyStatus() {
    return {
      fulltext: false, // Simulating no Meilisearch
      vector: false,   // Simulating no vector store
      tokens: true,    // Tokens always available
      available: ['tokens' as const],
    }
  }

  async searchTools(query: string, options: { limit?: number; userFeatures?: string[]; isSuperAdmin?: boolean } = {}) {
    const { limit = 12, userFeatures = [], isSuperAdmin = false } = options
    const lowerQuery = query.toLowerCase()

    // Simple keyword matching simulation
    const results = testTools
      .filter(tool => {
        // Check ACL
        if (!isSuperAdmin && tool.requiredFeatures.length > 0) {
          const hasAccess = tool.requiredFeatures.every(f => userFeatures.includes(f))
          if (!hasAccess) return false
        }

        // Simple relevance check
        return tool.name.toLowerCase().includes(lowerQuery) ||
               tool.description.toLowerCase().includes(lowerQuery)
      })
      .map((tool, index) => ({
        toolName: tool.name,
        score: 0.8 - (index * 0.1), // Descending scores
        moduleId: tool.moduleId,
        requiredFeatures: tool.requiredFeatures,
      }))
      .slice(0, limit)

    return results
  }
}

const mockSearchService = new MockToolSearchService()

// Async tests
async function runAsyncTests() {
  // Test search with superadmin
  const adminResults = await mockSearchService.searchTools('customer', { isSuperAdmin: true })
  assert(adminResults.length > 0, `Superadmin search found ${adminResults.length} results`)
  assert(adminResults.some(r => r.toolName.includes('customer')), 'Superadmin can find customer tools')

  // Test search with limited permissions
  const limitedResults = await mockSearchService.searchTools('customer', {
    userFeatures: ['customers.people.view'],
    isSuperAdmin: false
  })
  assert(limitedResults.length > 0, `Limited user search found ${limitedResults.length} results`)
  // Should not include customers_create (requires manage permission)
  assert(!limitedResults.some(r => r.toolName === 'customers_create'), 'Limited user cannot see manage-only tools')

  // ============= Test Discovery Flow =============

  console.log('\n=== Testing Discovery Flow ===\n')

  // Create mock tool context
  const mockContext: McpToolContext = {
    tenantId: 'test-tenant',
    organizationId: 'test-org',
    userId: 'test-user',
    container: {} as any,
    userFeatures: ['customers.people.view', 'sales.orders.view', 'catalog.products.view'],
    isSuperAdmin: false,
  }

  // Test discoverTools with mock service
  const discovery = await discoverTools(
    'find customers',
    mockContext,
    mockSearchService as any,
    registry,
    { limit: 10, includeEssential: true }
  )

  console.log('Discovery result:')
  console.log(`  Quality: ${discovery.quality}`)
  console.log(`  Strategies: ${discovery.strategies.join(', ')}`)
  console.log(`  Tools found: ${discovery.tools.length}`)
  console.log(`  Tools: ${discovery.tools.slice(0, 5).join(', ')}...`)

  assert(discovery.tools.length > 0, 'Discovery found tools')
  assert(discovery.strategies.includes('tokens'), 'Discovery used tokens strategy')

  // Check essential tools are included
  for (const essential of ESSENTIAL_TOOLS) {
    assert(discovery.tools.includes(essential), `Essential tool ${essential} is included`)
  }

  // ============= Test Module Fallback =============

  console.log('\n=== Testing Module Fallback ===\n')

  // Create a mock that returns no results to trigger fallback
  const emptySearchService = {
    async getStrategyStatus() {
      return { fulltext: false, vector: false, tokens: true, available: ['tokens' as const] }
    },
    async searchTools() {
      return [] // No results
    },
  }

  const fallbackDiscovery = await discoverTools(
    'show me all orders',
    mockContext,
    emptySearchService as any,
    registry,
    { limit: 10, includeEssential: true }
  )

  console.log('Fallback discovery result:')
  console.log(`  Quality: ${fallbackDiscovery.quality}`)
  console.log(`  Detected module: ${fallbackDiscovery.detectedModule}`)
  console.log(`  Tools found: ${fallbackDiscovery.tools.length}`)

  assert(fallbackDiscovery.quality === 'fallback_module', 'Quality is fallback_module')
  assert(fallbackDiscovery.detectedModule === 'sales', 'Detected sales module from "orders"')

  // ============= Summary =============

  console.log('\n=== All Tests Passed ===\n')
  console.log('Summary:')
  console.log(`  - Entity ID: ${TOOL_ENTITY_ID}`)
  console.log(`  - Global Tenant ID: ${GLOBAL_TENANT_ID}`)
  console.log(`  - Essential Tools: ${ESSENTIAL_TOOLS.length}`)
  console.log(`  - Test Tools Registered: ${testTools.length}`)
  console.log(`  - Module Detection: Working`)
  console.log(`  - Indexable Record: Working`)
  console.log(`  - Checksum: Working`)
  console.log(`  - Mock Search: Working`)
  console.log(`  - Discovery Flow: Working`)
  console.log(`  - Fallback: Working`)
  console.log('\n\u2705 Hybrid tool discovery integration test complete!')
}

runAsyncTests().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
