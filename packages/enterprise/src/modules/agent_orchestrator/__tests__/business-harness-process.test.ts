import path from 'node:path'
import { AgentExecutionBundleSchema } from '@open-mercato/business-harness/contracts'
import type { BusinessHarnessExecutionBundle } from '../lib/runtime/businessHarnessContracts'
import { BusinessHarnessProcessClient } from '../lib/runtime/businessHarnessProcessClient'
import {
  readBusinessHarnessRuntimeMode,
  resolveBusinessHarnessTransportMode,
} from '../lib/runtime/businessHarnessTransport'

const fixture = path.join(__dirname, 'fixtures', 'fake-business-harness-cli.mjs')

describe('business harness process transport', () => {
  it('sends a bundle the harness runtime accepts', () => {
    expect(AgentExecutionBundleSchema.safeParse(makeBundle()).success).toBe(true)
  })

  it('uses one subprocess per run, streams events and does not inherit arbitrary OM secrets', async () => {
    process.env.OM_TEST_LONG_SECRET = 'must-not-reach-the-runtime'
    const client = new BusinessHarnessProcessClient({
      cliPath: fixture,
      configFile: '/trusted/harness.config.json',
      credentialBrokerUrl: 'http://127.0.0.1:3000/broker',
    })
    const events: string[] = []

    try {
      const result = await client.run(makeBundle(), {
        onEvent: (event) => {
          events.push(event.type)
        },
      })

      expect(events).toEqual(['run.started'])
      expect(result.output).toEqual({ inheritedSecret: false })
      expect(result.identity.runId).toBe('run-process-1')
    } finally {
      delete process.env.OM_TEST_LONG_SECRET
    }
  })

  it('defaults to stdio and accepts HTTP as an explicit deployment option', () => {
    expect(resolveBusinessHarnessTransportMode(undefined)).toBe('stdio')
    expect(resolveBusinessHarnessTransportMode('cli')).toBe('stdio')
    expect(resolveBusinessHarnessTransportMode('http')).toBe('http')
    expect(readBusinessHarnessRuntimeMode(undefined)).toBe('one-off')
    expect(readBusinessHarnessRuntimeMode('service')).toBe('standalone')
    expect(readBusinessHarnessRuntimeMode('socket')).toBeNull()
    expect(() => resolveBusinessHarnessTransportMode('socket')).toThrow(
      'Unsupported OM_BUSINESS_HARNESS_TRANSPORT',
    )
  })
})

function makeBundle(): BusinessHarnessExecutionBundle {
  // Kept parseable by the harness's own AgentExecutionBundleSchema (asserted below),
  // so this fixture cannot drift away from the shape the runner actually sends.
  return {
    protocolVersion: '1',
    runId: 'run-process-1',
    agent: {
      id: 'agent.process',
      version: '1',
      digest: '0123456789abcdef',
      runtimeProfile: 'business-v1',
      instructions: 'Return a result.',
      model: {
        bindingId: 'model-primary',
        bindingRevision: '1',
        driver: 'openai',
        modelId: 'gpt-5-mini',
        credentialBindingId: 'provider-openai',
      },
      capabilities: [],
      loop: { maxSteps: 1, timeoutMs: 120_000, maxToolCalls: 1 },
      output: { mode: 'object', schema: { type: 'object' } },
    },
    input: { prompt: 'test' },
    authorization: { runGrant: 'a-run-grant-token-value' },
  }
}
