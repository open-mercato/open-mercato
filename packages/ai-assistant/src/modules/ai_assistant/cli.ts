import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg?.startsWith('--')) continue

    const [key, value] = arg.replace(/^--/, '').split('=')
    if (value !== undefined) {
      args[key] = value
    } else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
      args[key] = rest[i + 1]!
      i++
    } else {
      args[key] = true
    }
  }
  return args
}

const mcpServe: ModuleCli = {
  command: 'mcp:serve',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenant ?? args.tenantId ?? '') || null
    const organizationId = String(args.org ?? args.organizationId ?? '') || null
    const userId = String(args.user ?? args.userId ?? '') || null
    const debug = args.debug === true || args.debug === 'true'

    if (!tenantId) {
      console.error('Usage: mercato ai_assistant mcp:serve --tenant <tenantId> [options]')
      console.error('')
      console.error('Options:')
      console.error('  --tenant <id>    Tenant ID (required)')
      console.error('  --org <id>       Organization ID (optional)')
      console.error('  --user <id>      User ID for ACL (optional, uses superadmin if not set)')
      console.error('  --debug          Enable debug logging')
      console.error('')
      console.error('Example:')
      console.error('  mercato ai_assistant mcp:serve --tenant 123e4567-e89b-12d3-a456-426614174000')
      return
    }

    const container = await createRequestContainer()

    // Dynamically import to avoid loading MCP SDK until needed
    const { runMcpServer } = await import('./lib/mcp-server')

    await runMcpServer({
      config: {
        name: 'open-mercato-mcp',
        version: '0.1.0',
        debug,
      },
      container,
      context: {
        tenantId,
        organizationId,
        userId,
      },
    })
  },
}

const listTools: ModuleCli = {
  command: 'mcp:list-tools',
  async run() {
    const { getToolRegistry } = await import('./lib/tool-registry')
    const registry = getToolRegistry()
    const toolNames = registry.listToolNames()

    if (toolNames.length === 0) {
      console.log('\nNo MCP tools registered.')
      console.log('Tools can be registered by modules using registerMcpTool().\n')
      return
    }

    console.log(`\nRegistered MCP Tools (${toolNames.length}):\n`)

    for (const name of toolNames.sort()) {
      const tool = registry.getTool(name)
      if (tool) {
        console.log(`  ${name}`)
        console.log(`    Description: ${tool.description}`)
        if (tool.requiredFeatures?.length) {
          console.log(`    Requires: ${tool.requiredFeatures.join(', ')}`)
        }
        console.log('')
      }
    }
  },
}

export default [mcpServe, listTools]
