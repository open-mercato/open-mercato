import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import cliCommands from '../cli'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({})),
  getDiRegistrars: jest.fn(() => []),
}))

describe('ai_assistant agent-run prune CLI', () => {
  it('registers the run-agent-run-prune command', () => {
    const command = (cliCommands as ModuleCli[]).find((entry) => entry.command === 'run-agent-run-prune')
    expect(command).toBeDefined()
    expect(typeof command?.run).toBe('function')
  })
})
