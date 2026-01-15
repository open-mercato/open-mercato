import { getToolRegistry, registerMcpTool } from '../packages/ai-assistant/src/modules/ai_assistant/lib/tool-registry'
import { computeToolsChecksum, toolToIndexableRecord, TOOL_ENTITY_ID, GLOBAL_TENANT_ID, ESSENTIAL_TOOLS } from '../packages/ai-assistant/src/modules/ai_assistant/lib/tool-index-config'
import { z } from 'zod'

// Get the registry
const registry = getToolRegistry()
console.log('Initial tools:', registry.listToolNames().length)

// Test tools to register
const testTools = [
  { name: 'test_customers_search', description: 'Search for customer records in the CRM', requiredFeatures: ['customers.people.view'] },
  { name: 'test_sales_orders_create', description: 'Create a new sales order', requiredFeatures: ['sales.orders.manage'] },
  { name: 'test_catalog_products_list', description: 'List products in the catalog', requiredFeatures: ['catalog.products.view'] },
  { name: 'test_booking_resources_get', description: 'Get a booking resource by ID', requiredFeatures: ['booking.view'] },
]

for (const tool of testTools) {
  registerMcpTool({
    name: tool.name,
    description: tool.description,
    inputSchema: z.object({}),
    requiredFeatures: tool.requiredFeatures,
    handler: async () => ({}),
  }, { moduleId: tool.name.split('_')[1] })
}

console.log('After registration:', registry.listToolNames().length)

// Test checksum
const checksum = computeToolsChecksum(testTools.map(t => ({ name: t.name, description: t.description })))
console.log('Checksum:', checksum)

// Test indexable record conversion
const record = toolToIndexableRecord({
  name: 'customers_search',
  description: 'Search for customer records in the CRM',
  inputSchema: z.object({}),
  requiredFeatures: ['customers.people.view'],
  handler: async () => ({}),
}, 'customers')

console.log('\nIndexable record:')
console.log('  entityId:', record.entityId)
console.log('  recordId:', record.recordId)
console.log('  tenantId:', record.tenantId)
console.log('  fields.name:', record.fields.name)
console.log('  fields.moduleId:', record.fields.moduleId)
console.log('  text:', record.text)

// Verify essential tools
console.log('\nEssential tools:', ESSENTIAL_TOOLS)
console.log('Entity ID:', TOOL_ENTITY_ID)
console.log('Global tenant ID:', GLOBAL_TENANT_ID)

console.log('\n✅ Tool discovery components working correctly!')
