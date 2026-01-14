import { z } from 'zod'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { McpToolDefinition, McpToolContext } from './types'
import { registerMcpTool } from './tool-registry'

/**
 * Import all command modules to trigger registration.
 * This must be done before reading from commandRegistry.
 */
async function ensureCommandsRegistered(): Promise<void> {
  const commandModules = [
    '@open-mercato/core/modules/customers/commands',
    '@open-mercato/core/modules/catalog/commands',
    '@open-mercato/core/modules/sales/commands',
    '@open-mercato/core/modules/booking/commands',
    '@open-mercato/core/modules/auth/commands',
    '@open-mercato/core/modules/dictionaries/commands',
    '@open-mercato/core/modules/directory/commands',
    '@open-mercato/core/modules/currencies/commands',
    '@open-mercato/core/modules/feature_toggles/commands',
  ]

  for (const modulePath of commandModules) {
    try {
      await import(modulePath)
      console.log(`[Command Tools] Loaded commands from ${modulePath}`)
    } catch (error) {
      // Module might not have commands - this is not an error
      if (error instanceof Error && error.message.includes('Cannot find module')) {
        console.log(`[Command Tools] No commands module at ${modulePath}`)
      } else {
        console.error(`[Command Tools] Could not import ${modulePath}:`, error)
      }
    }
  }
}

/**
 * Commands that should not be exposed as MCP tools.
 * These are internal or system commands not suitable for AI execution.
 */
const EXCLUDE_PATTERNS = [
  /^audit_logs\./,
  /^dashboards\./,
  /\.sync$/,
  /^internal\./,
  /\.settings\./,
]

/**
 * Schema base name overrides for modules that don't follow conventions.
 * Key: "module.resource" pattern
 * Value: base name for schema (without Create/Update suffix)
 */
const SCHEMA_NAME_OVERRIDES: Record<string, string> = {
  // Booking module uses 'booking' prefix for all schemas
  'booking.services': 'bookingService',
  'booking.teams': 'bookingTeam',
  'booking.team-members': 'bookingTeamMember',
  'booking.team-roles': 'bookingTeamRole',
  'booking.resources': 'bookingResource',
  'booking.resource-types': 'bookingResourceType',
  'booking.resourceTypes': 'bookingResourceType',
  'booking.resource-tags': 'bookingResourceTag',
  'booking.resourceTags': 'bookingResourceTag',
  'booking.events': 'bookingEvent',
  'booking.event-attendees': 'bookingEventAttendee',
  'booking.event-members': 'bookingEventMember',
  'booking.event-resources': 'bookingEventResource',
  'booking.event-confirmations': 'bookingEventConfirmation',
  'booking.availability': 'bookingAvailabilityRule',
  'booking.availability-rules': 'bookingAvailabilityRule',
  'booking.availability-rule-sets': 'bookingAvailabilityRuleSet',

  // Customers module - special cases
  'customers.people': 'person',
  'customers.addresses': 'address',
  'customers.dictionaryEntries': 'customerDictionaryEntry',

  // Sales module - special cases
  'sales.tags': 'salesTag',
  'sales.tax-rates': 'taxRate',
  'sales.order-statuses': 'statusDictionary',
  'sales.order-line-statuses': 'statusDictionary',
  'sales.shipment-statuses': 'statusDictionary',
  'sales.payment-statuses': 'statusDictionary',

  // Dictionaries module
  'dictionaries.entries': 'dictionaryEntryCommand',

  // Catalog module - special cases
  'catalog.optionSchemas': 'optionSchemaTemplate',

  // Feature toggles module - uses 'toggle' prefix
  'feature_toggles.global': 'toggle',
}

/**
 * Map of command ID patterns to their validator schema names.
 * Format: commandId -> { import: '@package/path', schema: 'schemaName' }
 */
type SchemaMapping = {
  importPath: string
  schemaName: string
}

/**
 * Parse command ID into module, resource, and action.
 * Example: 'customers.people.create' -> { module: 'customers', resource: 'people', action: 'create' }
 */
function parseCommandId(commandId: string): { module: string; resource: string; action: string } | null {
  const parts = commandId.split('.')
  if (parts.length < 3) return null
  return {
    module: parts[0],
    resource: parts[1],
    action: parts.slice(2).join('.'),
  }
}

/**
 * Convert a command ID to a valid MCP tool name.
 * AI providers require tool names to match: ^[a-zA-Z0-9_-]{1,128}$
 * This replaces dots with underscores.
 * Example: 'customers.people.create' -> 'customers_people_create'
 */
function commandIdToToolName(commandId: string): string {
  return commandId.replace(/\./g, '_')
}

/**
 * Convert resource name to schema name convention.
 * Examples:
 * - 'people' + 'create' -> 'personCreateSchema'
 * - 'companies' + 'update' -> 'companyUpdateSchema'
 * - 'dictionary_entries' + 'create' -> 'dictionaryEntryCreateSchema'
 * - 'team-members' + 'create' -> 'teamMemberCreateSchema'
 */
function toSchemaName(module: string, resource: string, action: string): string {
  // Check for explicit overrides first
  const overrideKey = `${module}.${resource}`
  const override = SCHEMA_NAME_OVERRIDES[overrideKey]
  if (override) {
    const capitalizedAction = action.charAt(0).toUpperCase() + action.slice(1)
    return `${override}${capitalizedAction}Schema`
  }

  // Convert hyphen-case to camelCase: team-members -> teamMembers
  let camelResource = resource.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

  // Singularize common plural patterns
  let singular = camelResource
  if (singular.endsWith('ies')) {
    // categories -> category
    singular = singular.slice(0, -3) + 'y'
  } else if (singular.endsWith('sses') || singular.endsWith('xes') || singular.endsWith('ches') || singular.endsWith('shes')) {
    // addresses -> address, boxes -> box, watches -> watch, dishes -> dish
    singular = singular.slice(0, -2)
  } else if (singular.endsWith('s') && !singular.endsWith('ss')) {
    // products -> product, quotes -> quote, prices -> price, notes -> note
    singular = singular.slice(0, -1)
  }

  // Convert snake_case to camelCase
  const camelSingular = singular.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())

  // Capitalize action
  const capitalizedAction = action.charAt(0).toUpperCase() + action.slice(1)

  return `${camelSingular}${capitalizedAction}Schema`
}

/**
 * Derive the import path for a module's validators.
 */
function getValidatorImportPath(module: string): string {
  // Map module names to their package locations
  const moduleToPackage: Record<string, string> = {
    auth: '@open-mercato/core/modules/auth/data/validators',
    catalog: '@open-mercato/core/modules/catalog/data/validators',
    customers: '@open-mercato/core/modules/customers/data/validators',
    sales: '@open-mercato/core/modules/sales/data/validators',
    booking: '@open-mercato/core/modules/booking/data/validators',
    dictionaries: '@open-mercato/core/modules/dictionaries/data/validators',
    directory: '@open-mercato/core/modules/directory/data/validators',
    currencies: '@open-mercato/core/modules/currencies/data/validators',
    feature_toggles: '@open-mercato/core/modules/feature_toggles/data/validators',
    example: '@open-mercato/example/modules/example/data/validators',
  }

  return moduleToPackage[module] || `@open-mercato/core/modules/${module}/data/validators`
}

/**
 * Derive the schema mapping for a command.
 */
function getSchemaMapping(commandId: string): SchemaMapping | null {
  const parsed = parseCommandId(commandId)
  if (!parsed) return null

  const { module, resource, action } = parsed

  // Only handle create/update actions (delete uses inline schema)
  if (action !== 'create' && action !== 'update') {
    return null
  }

  return {
    importPath: getValidatorImportPath(module),
    schemaName: toSchemaName(module, resource, action),
  }
}

/**
 * Generate a description for a command tool.
 */
function generateDescription(commandId: string): string {
  const parsed = parseCommandId(commandId)
  if (!parsed) return `Execute ${commandId} command`

  const { module, resource, action } = parsed
  const humanModule = module.replace(/_/g, ' ')
  const humanResource = resource.replace(/_/g, ' ')

  switch (action) {
    case 'create':
      return `Create a new ${humanResource} in ${humanModule}`
    case 'update':
      return `Update an existing ${humanResource} in ${humanModule}`
    case 'delete':
      return `Delete a ${humanResource} from ${humanModule}`
    default:
      return `Execute ${action} on ${humanResource} in ${humanModule}`
  }
}

/**
 * Derive required features for a command.
 */
function deriveRequiredFeatures(commandId: string): string[] {
  const parsed = parseCommandId(commandId)
  if (!parsed) return []

  const { module, resource, action } = parsed

  // Map actions to feature suffixes
  const featureSuffix = ['create', 'update', 'delete'].includes(action) ? 'manage' : 'view'

  return [`${module}.${resource}.${featureSuffix}`]
}

/**
 * Build CommandRuntimeContext from McpToolContext.
 * Note: When authenticated via API key, userId is "api_key:<uuid>" which is not
 * a valid UUID for the actor_user_id column. We extract the API key UUID to use
 * as the actor, since api_keys.id is a valid UUID that can be stored.
 */
function buildCommandContext(ctx: McpToolContext): CommandRuntimeContext {
  // API key auth uses "api_key:<uuid>" format - extract the UUID part
  const isApiKeyAuth = ctx.userId?.startsWith('api_key:')
  const actorId = isApiKeyAuth ? ctx.userId.slice('api_key:'.length) : ctx.userId

  return {
    container: ctx.container,
    auth: ctx.tenantId
      ? {
          sub: actorId ?? undefined,
          tenantId: ctx.tenantId ?? undefined,
          orgId: ctx.organizationId ?? undefined,
        }
      : null,
    organizationScope: null,
    selectedOrganizationId: ctx.organizationId,
    organizationIds: ctx.organizationId ? [ctx.organizationId] : null,
  }
}

/**
 * Schema cache to avoid repeated imports.
 */
const schemaCache = new Map<string, z.ZodType>()

/**
 * Context fields that should be stripped from input schemas and injected from auth.
 * These are automatically provided by the MCP server based on API key authentication.
 */
const CONTEXT_FIELDS = ['tenantId', 'organizationId'] as const

/**
 * Convert z.date() to z.string() for JSON Schema compatibility.
 * Recursively handles nested objects and arrays.
 */
function convertDatesToStrings(schema: z.ZodType): z.ZodType {
  // Handle ZodDate - convert to string with datetime format
  if (schema._def.typeName === 'ZodDate') {
    return z.string().datetime().describe('ISO 8601 datetime string')
  }

  // Handle ZodOptional wrapping a date
  if (schema._def.typeName === 'ZodOptional') {
    const inner = convertDatesToStrings(schema._def.innerType)
    return inner.optional()
  }

  // Handle ZodNullable wrapping a date
  if (schema._def.typeName === 'ZodNullable') {
    const inner = convertDatesToStrings(schema._def.innerType)
    return inner.nullable()
  }

  // Handle ZodDefault wrapping a date
  if (schema._def.typeName === 'ZodDefault') {
    const inner = convertDatesToStrings(schema._def.innerType)
    return inner
  }

  // Handle ZodArray - convert inner type
  if (schema._def.typeName === 'ZodArray') {
    const innerType = convertDatesToStrings(schema._def.type)
    return z.array(innerType)
  }

  // Handle ZodObject - recursively process shape
  if ('shape' in schema && typeof schema.shape === 'object') {
    const shape = schema.shape as Record<string, z.ZodType>
    const newShape: Record<string, z.ZodType> = {}

    for (const [key, value] of Object.entries(shape)) {
      newShape[key] = convertDatesToStrings(value)
    }

    return z.object(newShape)
  }

  return schema
}

/**
 * Strip context fields (tenantId, organizationId) from a Zod schema.
 * Also converts Date fields to strings for JSON Schema compatibility.
 * These fields are injected from the auth context, not provided by the AI.
 */
function stripContextFields(schema: z.ZodType): z.ZodType {
  // Check if it's a ZodObject by looking for the shape property
  // Works with z.object(), .extend(), .merge(), etc.
  if ('shape' in schema && typeof schema.shape === 'object') {
    const shape = schema.shape as Record<string, z.ZodType>
    const newShape: Record<string, z.ZodType> = {}

    for (const [key, value] of Object.entries(shape)) {
      if (!CONTEXT_FIELDS.includes(key as (typeof CONTEXT_FIELDS)[number])) {
        // Convert dates to strings for JSON Schema compatibility
        newShape[key] = convertDatesToStrings(value)
      }
    }

    return z.object(newShape)
  }

  return schema
}

/**
 * Static imports for validator modules - required because dynamic import() doesn't work with variable paths
 */
const validatorModules: Record<string, Record<string, unknown>> = {}

async function ensureValidatorModulesLoaded(): Promise<void> {
  if (Object.keys(validatorModules).length > 0) return

  try {
    validatorModules['customers'] = await import('@open-mercato/core/modules/customers/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load customers validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['catalog'] = await import('@open-mercato/core/modules/catalog/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load catalog validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['sales'] = await import('@open-mercato/core/modules/sales/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load sales validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['booking'] = await import('@open-mercato/core/modules/booking/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load booking validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['dictionaries'] = await import('@open-mercato/core/modules/dictionaries/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load dictionaries validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['directory'] = await import('@open-mercato/core/modules/directory/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load directory validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['currencies'] = await import('@open-mercato/core/modules/currencies/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load currencies validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['auth'] = await import('@open-mercato/core/modules/auth/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load auth validators:', e instanceof Error ? e.message : e)
  }

  try {
    validatorModules['feature_toggles'] = await import('@open-mercato/core/modules/feature_toggles/data/validators')
  } catch (e) {
    console.warn('[Command Tools] Could not load feature_toggles validators:', e instanceof Error ? e.message : e)
  }
}

/**
 * Load a schema from pre-loaded validator modules.
 */
async function loadSchema(mapping: SchemaMapping, commandId: string): Promise<z.ZodType | null> {
  const cacheKey = `${mapping.importPath}:${mapping.schemaName}`
  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey)!
  }

  // Ensure validator modules are loaded
  await ensureValidatorModulesLoaded()

  // Extract module name from import path
  const parsed = parseCommandId(commandId)
  if (!parsed) return null

  const validatorModule = validatorModules[parsed.module]
  if (!validatorModule) {
    console.warn(`[Command Tools] No validator module loaded for "${parsed.module}" (command: ${commandId})`)
    return null
  }

  const schema = validatorModule[mapping.schemaName]
  if (schema && typeof schema === 'object' && '_def' in schema) {
    schemaCache.set(cacheKey, schema as z.ZodType)
    return schema as z.ZodType
  }

  // Schema name not found in module - log for debugging
  console.warn(
    `[Command Tools] Schema "${mapping.schemaName}" not found in ${parsed.module} validators for command ${commandId}`
  )

  return null
}

/**
 * Create a default schema for delete commands (just id).
 */
const deleteSchema = z.object({
  id: z.string().uuid().describe('The ID of the record to delete'),
})

/**
 * Build MCP tools from registered commands.
 * This imports all command modules and creates MCP tools from them.
 */
export async function buildCommandTools(): Promise<McpToolDefinition[]> {
  // First, ensure all commands are registered by importing command modules
  await ensureCommandsRegistered()

  const tools: McpToolDefinition[] = []

  // Get all registered command handler IDs using the public API
  const commandIds = commandRegistry.list()

  if (commandIds.length === 0) {
    console.warn('[Command Tools] No commands found in registry')
    return tools
  }

  const skippedCommands: string[] = []
  const loadedCommands: string[] = []

  for (const commandId of commandIds) {
    // Skip excluded commands
    if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(commandId))) {
      continue
    }

    const parsed = parseCommandId(commandId)
    if (!parsed) continue

    let inputSchema: z.ZodType

    if (parsed.action === 'delete') {
      // Use default delete schema
      inputSchema = deleteSchema
      loadedCommands.push(commandId)
    } else {
      // Try to load the schema
      const mapping = getSchemaMapping(commandId)
      if (!mapping) {
        skippedCommands.push(`${commandId} (no mapping)`)
        continue
      }

      const schema = await loadSchema(mapping, commandId)
      if (!schema) {
        // Skip commands without schemas
        skippedCommands.push(`${commandId} (schema not found: ${mapping.schemaName})`)
        continue
      }
      // Strip context fields - they'll be injected from auth
      inputSchema = stripContextFields(schema)
      loadedCommands.push(commandId)
    }

    // Convert command ID to valid tool name (replace dots with underscores)
    const toolName = commandIdToToolName(commandId)

    const tool: McpToolDefinition = {
      name: toolName,
      description: generateDescription(commandId),
      inputSchema,
      requiredFeatures: deriveRequiredFeatures(commandId),
      handler: async (input: unknown, ctx: McpToolContext) => {
        const commandBus = ctx.container.resolve<CommandBus>('commandBus')
        const runtimeCtx = buildCommandContext(ctx)

        // Inject context fields from auth - AI doesn't need to provide these
        const enrichedInput = {
          ...(input as object),
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
        }

        const result = await commandBus.execute(commandId, {
          input: enrichedInput,
          ctx: runtimeCtx,
        })

        return {
          success: true,
          result: result.result,
          undoToken: result.logEntry?.undoToken ?? null,
        }
      },
    }

    tools.push(tool)
  }

  // Log summary of loaded vs skipped commands
  console.log(`[Command Tools] Loaded ${loadedCommands.length} command tools`)
  if (skippedCommands.length > 0) {
    console.warn(`[Command Tools] Skipped ${skippedCommands.length} commands (missing schemas):`)
    for (const cmd of skippedCommands.slice(0, 20)) {
      console.warn(`  - ${cmd}`)
    }
    if (skippedCommands.length > 20) {
      console.warn(`  ... and ${skippedCommands.length - 20} more`)
    }
  }

  return tools
}

/**
 * Load and register all command-derived tools.
 */
export async function loadCommandTools(): Promise<number> {
  const tools = await buildCommandTools()

  for (const tool of tools) {
    registerMcpTool(tool, { moduleId: 'commands' })
  }

  return tools.length
}
