import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

/**
 * Test command that prints its arguments
 * Usage: Trigger via API or CLI to see what args are passed
 */

type TestCommandInput = {
  message?: string
  tags: string[]
  [key: string]: unknown
}

type TestCommandResult = {
  printed: boolean
  timestamp: string
}

const testCommand: CommandHandler<TestCommandInput, TestCommandResult> = {
  id: 'scheduler.test.print-args',
  isUndoable: true,

  async execute(input: TestCommandInput, ctx: CommandRuntimeContext): Promise<TestCommandResult> {
    console.log('\n=== Test Command Executed ===')
    console.log('Command ID:', this.id)
    console.log('Timestamp:', new Date().toISOString())
    console.log('\nInput payload:')
    console.log(JSON.stringify(input, null, 2))
    console.log('\nAuth context:')
    console.log('  User ID:', ctx.auth?.sub || 'N/A')
    console.log('  Tenant ID:', ctx.auth?.tenantId || 'N/A')
    console.log('  Org ID:', ctx.auth?.orgId || 'N/A')
    console.log('  Is API Key:', ctx.auth?.isApiKey || false)
    console.log('\nContainer services available:')
    console.log('  Has container:', !!ctx.container)
    console.log('=============================\n')

    // Check if "error" tag is present in the payload
    if (input.tags && input.tags.includes('error')) {
      throw new Error('Test command failed: "error" tag found in payload')
    }
    throw new Error('Test command failed: "error" tag found in payload')


    return {
      printed: true,
      timestamp: new Date().toISOString(),
    }
  },

  async undo(params: { input: TestCommandInput; ctx: CommandRuntimeContext; logEntry: any }): Promise<void> {
    console.log('\n=== Test Command UNDO ===')
    console.log('Input:', JSON.stringify(params.input, null, 2))
    console.log('Log Entry:', JSON.stringify(params.logEntry, null, 2))
    console.log('=========================\n')
  },
}

// Register the command
registerCommand(testCommand)
