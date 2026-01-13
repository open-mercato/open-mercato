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
    const apiKey = String(args['api-key'] ?? args.apiKey ?? '') || null
    const tenantId = String(args.tenant ?? args.tenantId ?? '') || null
    const organizationId = String(args.org ?? args.organizationId ?? '') || null
    const userId = String(args.user ?? args.userId ?? '') || null
    const debug = args.debug === true || args.debug === 'true'

    // Either API key or tenant is required
    if (!apiKey && !tenantId) {
      console.error('Usage: mercato ai_assistant mcp:serve [options]')
      console.error('')
      console.error('Authentication (choose one):')
      console.error('  --api-key <secret>   API key secret for authentication (recommended)')
      console.error('  --tenant <id>        Tenant ID (for manual context)')
      console.error('')
      console.error('Options (with --tenant):')
      console.error('  --org <id>           Organization ID (optional)')
      console.error('  --user <id>          User ID for ACL (optional, uses superadmin if not set)')
      console.error('')
      console.error('Common options:')
      console.error('  --debug              Enable debug logging')
      console.error('')
      console.error('Examples:')
      console.error('  mercato ai_assistant mcp:serve --api-key omk_xxxx.yyyy...')
      console.error('  mercato ai_assistant mcp:serve --tenant 123e4567-e89b-12d3-a456-426614174000')
      return
    }

    const container = await createRequestContainer()

    const { runMcpServer } = await import('./lib/mcp-server')

    if (apiKey) {
      await runMcpServer({
        config: {
          name: 'open-mercato-mcp',
          version: '0.1.0',
          debug,
        },
        container,
        apiKeySecret: apiKey,
      })
    } else {
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
    }
  },
}

const mcpServeHttp: ModuleCli = {
  command: 'mcp:serve-http',
  async run(rest) {
    const args = parseArgs(rest)
    const port = parseInt(String(args.port ?? ''), 10)
    const debug = args.debug === true || args.debug === 'true'

    if (!port || isNaN(port)) {
      console.error('Usage: mercato ai_assistant mcp:serve-http --port <port> [options]')
      console.error('')
      console.error('Options:')
      console.error('  --port <number>    Port to listen on (required)')
      console.error('  --debug            Enable debug logging')
      console.error('')
      console.error('Authentication:')
      console.error('  Clients must provide API key via x-api-key header')
      console.error('')
      console.error('Example:')
      console.error('  mercato ai_assistant mcp:serve-http --port 3001')
      return
    }

    const container = await createRequestContainer()

    const { runMcpHttpServer } = await import('./lib/http-server')

    await runMcpHttpServer({
      config: {
        name: 'open-mercato-mcp',
        version: '0.1.0',
        debug,
      },
      container,
      port,
    })
  },
}

const listTools: ModuleCli = {
  command: 'mcp:list-tools',
  async run(rest) {
    const args = parseArgs(rest)
    const verbose = args.verbose === true || args.verbose === 'true'

    const { loadAllModuleTools } = await import('./lib/tool-loader')
    await loadAllModuleTools()

    const { getToolRegistry } = await import('./lib/tool-registry')
    const registry = getToolRegistry()
    const toolNames = registry.listToolNames()

    if (toolNames.length === 0) {
      console.log('\nNo MCP tools registered.')
      console.log('Tools can be registered by modules using registerMcpTool().\n')
      return
    }

    console.log(`\nRegistered MCP Tools (${toolNames.length}):\n`)

    // Group tools by module
    const byModule = new Map<string, string[]>()
    for (const name of toolNames) {
      const [module] = name.split('.')
      const list = byModule.get(module) ?? []
      list.push(name)
      byModule.set(module, list)
    }

    // Sort modules alphabetically
    const sortedModules = Array.from(byModule.keys()).sort()

    for (const module of sortedModules) {
      const tools = byModule.get(module)!
      console.log(`${module} (${tools.length} tools):`)

      for (const name of tools.sort()) {
        const tool = registry.getTool(name)
        if (!tool) continue

        if (verbose) {
          console.log(`  ${name}`)
          console.log(`    ${tool.description}`)
          if (tool.requiredFeatures?.length) {
            console.log(`    Requires: ${tool.requiredFeatures.join(', ')}`)
          }
        } else {
          console.log(`  - ${name}`)
        }
      }
      console.log('')
    }
  },
}

export default [mcpServe, mcpServeHttp, listTools]
