import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpClient } from '../mcp-client'

describe('McpClient stdio integration', () => {
  it('starts exactly one SDK-managed server process for one stdio client connection', async () => {
    const previousSpawnLog = process.env.MCP_SPAWN_LOG
    const logPath = path.join(os.tmpdir(), `open-mercato-mcp-spawn-${Date.now()}.log`)
    process.env.MCP_SPAWN_LOG = logPath

    const serverCode = `
import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
fs.appendFileSync(process.env.MCP_SPAWN_LOG, String(process.pid) + '\\n');
const server = new Server(
  { name: 'open-mercato-spawn-proof', version: '1.0.0' },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
await server.connect(new StdioServerTransport());
`

    try {
      const client = await McpClient.connect({
        transport: 'stdio',
        apiKeySecret: 'test-secret',
        command: process.execPath,
        args: ['--input-type=module', '-e', serverCode],
        cwd: process.cwd(),
      })

      try {
        await expect(client.listTools()).resolves.toEqual([])
      } finally {
        await client.close()
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
      const pids = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      expect(pids).toHaveLength(1)
    } finally {
      if (previousSpawnLog === undefined) {
        delete process.env.MCP_SPAWN_LOG
      } else {
        process.env.MCP_SPAWN_LOG = previousSpawnLog
      }
      fs.rmSync(logPath, { force: true })
    }
  })
})
