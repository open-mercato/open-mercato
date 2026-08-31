export type BusinessHarnessModelDriver = 'openai' | 'anthropic' | 'openai-compatible'

export type BusinessHarnessModelBinding = {
  bindingId: string
  bindingRevision: string
  driver: BusinessHarnessModelDriver
  modelId: string
  baseUrl?: string
  credentialBindingId: string
  settings?: {
    temperature?: number
    topP?: number
    maxOutputTokens?: number
    maxRetries?: number
    seed?: number
  }
}

export type BusinessHarnessExecutionBundle = {
  protocolVersion: '1'
  runId: string
  agent: {
    id: string
    version: string
    digest: string
    runtimeProfile: string
    instructions: string
    model: BusinessHarnessModelBinding
    capabilities: Array<{
      connectorId: string
      allowedTools: string[]
      access: 'read' | 'write'
    }>
    loop: {
      maxSteps: number
      timeoutMs: number
      maxToolCalls: number
    }
    output: {
      mode: 'object'
      schema: Record<string, unknown>
      name?: string
      description?: string
    }
  }
  input: {
    prompt: string
    context?: Record<string, unknown>
  }
  authorization: {
    runGrant: string
  }
}

export type BusinessHarnessRunUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type BusinessHarnessRunEvent =
  | { type: 'run.started'; runId: string; timestamp: string }
  | { type: 'capabilities.ready'; runId: string; toolCount: number; timestamp: string }
  | {
      type: 'step.finished'
      runId: string
      step: number
      finishReason: string
      usage: BusinessHarnessRunUsage
      timestamp: string
    }
  | {
      type: 'tool.started'
      runId: string
      toolName: string
      connectorId: string
      capabilityToolName: string
      call: number
      timestamp: string
    }
  | {
      type: 'tool.finished'
      runId: string
      toolName: string
      connectorId: string
      capabilityToolName: string
      call: number
      durationMs: number
      isError: boolean
      timestamp: string
    }
  | { type: 'run.completed'; runId: string; durationMs: number; timestamp: string }
  | { type: 'run.failed'; runId: string; code: string; timestamp: string }

export type BusinessHarnessRunResult = {
  protocolVersion: '1'
  status: 'completed'
  identity: {
    runId: string
    agentId: string
    agentVersion: string
    agentDigest: string
    runtimeProfile: string
    model: {
      bindingId: string
      bindingRevision: string
      driver: BusinessHarnessModelDriver
      modelId: string
    }
    connectors: string[]
    toolCatalogDigest: string
  }
  output: unknown
  usage: BusinessHarnessRunUsage
  steps: number
  toolCalls: number
  durationMs: number
}
