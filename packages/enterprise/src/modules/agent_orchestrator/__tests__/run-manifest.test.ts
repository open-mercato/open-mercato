import {
  RUN_MANIFEST_MAX_CHARS,
  RUN_MANIFEST_SPAN_NAME,
  buildRunManifestAttributes,
  computeManifestSha256,
  measureRunManifest,
  runManifestExternalSpanId,
  type RunManifestInput,
} from '../lib/trace/runManifest'

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

function codeAgentInput(overrides: Partial<RunManifestInput> = {}): RunManifestInput {
  return {
    runtime: 'native',
    agentId: 'deals.health_check',
    definitionHash: computeManifestSha256('definition'),
    agentSource: 'code',
    ctx: { userId: 'user-1' },
    promptOverride: { id: 'override-1', version: 4 },
    systemPromptSha256: computeManifestSha256('system prompt'),
    skills: [
      { id: 'stage_playbook', sha256: computeManifestSha256('playbook') },
      { id: 'pricing_rules', sha256: computeManifestSha256('pricing') },
    ],
    toolsSha256: computeManifestSha256('tools'),
    toolNames: ['customers.get_deal', 'catalog.get_product'],
    modelDeclared: 'model-declared',
    modelResolved: 'model-resolved',
    provider: 'provider-a',
    observation: { knowledge: { 'rules.rule_set': { version: '2026-10-20.3' } } },
    invoker: { kind: 'api_key', userId: null, apiKeyId: 'key-1', ownerUserId: 'owner-1' },
    entryPoint: 'ai_assistant',
    channel: 'chat',
    correlationId: 'corr-1',
    runAs: { agentPrincipalId: 'principal-1', agentUserId: 'agent-user-1', onBehalfOfUserId: 'user-1' },
    traceparent: '00-trace-span-01',
    ...overrides,
  }
}

describe('run manifest builder', () => {
  it('exposes the span name and external span id', () => {
    expect(RUN_MANIFEST_SPAN_NAME).toBe('run.manifest')
    expect(runManifestExternalSpanId('run-42')).toBe('run-42:manifest')
  })

  it('emits the full key set for a code agent', () => {
    const attributes = buildRunManifestAttributes(codeAgentInput())
    expect(Object.keys(attributes).sort((left, right) => left.localeCompare(right))).toEqual(
      [
        'om.agent.definition_hash',
        'om.agent.id',
        'om.agent.source',
        'om.capture',
        'om.channel',
        'om.correlation_id',
        'om.entry_point',
        'om.invoker',
        'om.knowledge',
        'om.manifest.version',
        'om.model.declared',
        'om.model.resolved',
        'om.platform_trace',
        'om.principal',
        'om.prompt.override',
        'om.prompt.system.sha256',
        'om.provider',
        'om.runtime',
        'om.skills',
        'om.tools.names',
        'om.tools.sha256',
      ].sort((left, right) => left.localeCompare(right)),
    )
    expect(attributes['om.manifest.version']).toBe(1)
    expect(attributes['om.agent.definition_hash']).toMatch(HASH_PATTERN)
    expect(attributes['om.prompt.system.sha256']).toMatch(HASH_PATTERN)
    expect(attributes['om.tools.sha256']).toMatch(HASH_PATTERN)
    expect(attributes['om.skills'].map((skill) => skill.id)).toEqual(['pricing_rules', 'stage_playbook'])
    expect(attributes['om.tools.names']).toEqual(['catalog.get_product', 'customers.get_deal'])
    expect(attributes['om.knowledge']).toEqual({ 'rules.rule_set': '2026-10-20.3' })
    expect(attributes['om.invoker']).toEqual({ kind: 'api_key', userId: null, apiKeyId: 'key-1', ownerUserId: 'owner-1' })
    expect(attributes['om.principal']).toEqual({
      agentPrincipalId: 'principal-1',
      agentUserId: 'agent-user-1',
      onBehalfOfUserId: 'user-1',
    })
    expect(attributes['om.capture']).toEqual({ level: 'metadata', source: 'deployment', retentionDays: 30, redactPii: false })
    expect(attributes['om.platform_trace']).toEqual({ traceparent: '00-trace-span-01' })
    expect(attributes['om.manifest.truncated']).toBeUndefined()
  })

  it('normalizes plain hex hashes to the sha256 prefix', () => {
    const plainHex = computeManifestSha256('plain').slice('sha256:'.length)
    const attributes = buildRunManifestAttributes(codeAgentInput({ systemPromptSha256: plainHex }))
    expect(attributes['om.prompt.system.sha256']).toBe(`sha256:${plainHex}`)
  })

  it('falls back to a user invoker derived from ctx.userId', () => {
    const attributes = buildRunManifestAttributes(codeAgentInput({ invoker: undefined }))
    expect(attributes['om.invoker']).toEqual({ kind: 'user', userId: 'user-1', apiKeyId: null, ownerUserId: null })
  })

  it('omits entry point, channel, principal, override and trace carrier when absent', () => {
    const attributes = buildRunManifestAttributes(
      codeAgentInput({
        entryPoint: undefined,
        channel: 'chat',
        runAs: null,
        promptOverride: null,
        traceparent: null,
        correlationId: undefined,
      }),
    )
    expect(attributes).not.toHaveProperty('om.entry_point')
    expect(attributes).not.toHaveProperty('om.channel')
    expect(attributes).not.toHaveProperty('om.principal')
    expect(attributes).not.toHaveProperty('om.prompt.override')
    expect(attributes).not.toHaveProperty('om.platform_trace')
    expect(attributes['om.correlation_id']).toBeNull()
  })

  it('records the channel only for ai_assistant and tool entry points', () => {
    expect(buildRunManifestAttributes(codeAgentInput({ entryPoint: 'tool', channel: 'mcp' }))['om.channel']).toBe('mcp')
    const workflowRun = buildRunManifestAttributes(codeAgentInput({ entryPoint: 'workflow', channel: 'internal' }))
    expect(workflowRun['om.entry_point']).toBe('workflow')
    expect(workflowRun).not.toHaveProperty('om.channel')
  })

  it('applies provided capture settings over the defaults', () => {
    const attributes = buildRunManifestAttributes(codeAgentInput({ capture: { level: 'full', source: 'agent', redactPii: true } }))
    expect(attributes['om.capture']).toEqual({ level: 'full', source: 'agent', retentionDays: 30, redactPii: true })
  })

  it('trims tool names, then knowledge, then skills to stay within the size cap', () => {
    const toolNames = Array.from({ length: 300 }, (_entry, index) => `module_${index}.tool_with_a_long_name_${index}`)
    const knowledge = Object.fromEntries(
      Array.from({ length: 50 }, (_entry, index) => [`rules.key_${String(index).padStart(2, '0')}`, { version: `v${index}` }]),
    )
    const attributes = buildRunManifestAttributes(codeAgentInput({ toolNames, observation: { knowledge } }))
    expect(measureRunManifest(attributes)).toBeLessThanOrEqual(RUN_MANIFEST_MAX_CHARS)
    expect(attributes['om.manifest.truncated']).toBe(true)
    expect(attributes['om.tools.names'].length).toBeLessThan(toolNames.length)
    expect(Object.keys(attributes['om.knowledge'])).toHaveLength(50)
    expect(attributes['om.skills']).toHaveLength(2)
  })

  it('drops knowledge keys in reverse sorted order once tool names are exhausted', () => {
    const knowledge = Object.fromEntries(
      Array.from({ length: 200 }, (_entry, index) => [
        `rules.knowledge_key_${String(index).padStart(3, '0')}`,
        { version: `version-${index}` },
      ]),
    )
    const attributes = buildRunManifestAttributes(codeAgentInput({ observation: { knowledge } }))
    expect(measureRunManifest(attributes)).toBeLessThanOrEqual(RUN_MANIFEST_MAX_CHARS)
    expect(attributes['om.manifest.truncated']).toBe(true)
    expect(attributes['om.tools.names']).toEqual([])
    const keptKeys = Object.keys(attributes['om.knowledge'])
    expect(keptKeys.length).toBeGreaterThan(0)
    expect(keptKeys.length).toBeLessThan(200)
    expect(keptKeys[0]).toBe('rules.knowledge_key_000')
    expect(attributes['om.skills']).toHaveLength(2)
  })

  it('produces deterministic output for the same input', () => {
    const first = JSON.stringify(buildRunManifestAttributes(codeAgentInput()))
    const second = JSON.stringify(
      buildRunManifestAttributes(
        codeAgentInput({
          toolNames: ['customers.get_deal', 'catalog.get_product', 'customers.get_deal'],
          skills: [
            { id: 'pricing_rules', sha256: computeManifestSha256('pricing') },
            { id: 'stage_playbook', sha256: computeManifestSha256('playbook') },
          ],
        }),
      ),
    )
    expect(second).toBe(first)
  })
})
