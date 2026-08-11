import {
  agentSampleInputKeys,
  agentSampleInputRows,
  buildAgentSourcePaths,
  isKnownAgentSourcePath,
  isTemplateExpression,
} from '../agent-outcome-paths'

const nestedOutcome = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    customer: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        flags: { type: 'object' },
      },
    },
    actions: { type: 'array' },
  },
}

describe('buildAgentSourcePaths', () => {
  test('puts a proposal agent OUTCOME under proposalPayload alongside the envelope keys', () => {
    const paths = buildAgentSourcePaths('proposal', { type: 'object', properties: { score: { type: 'number' } } })
    expect(paths.map((entry) => entry.path)).toEqual([
      'kind',
      'disposition',
      'agentId',
      'proposalId',
      'proposalPayload',
      'proposalPayload.score',
    ])
    expect(paths.find((entry) => entry.path === 'proposalPayload.score')?.type).toBe('number')
  })

  test('puts a researcher agent OUTCOME under data', () => {
    const paths = buildAgentSourcePaths('researcher', { type: 'object', properties: { summary: { type: 'string' } } })
    expect(paths.map((entry) => entry.path)).toContain('data.summary')
    expect(paths.map((entry) => entry.path)).not.toContain('proposalPayload')
  })

  test('descends into described objects and marks undescribed ones as open containers', () => {
    const paths = buildAgentSourcePaths('proposal', nestedOutcome)
    expect(paths.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'proposalPayload.customer',
        'proposalPayload.customer.email',
        'proposalPayload.customer.flags',
        'proposalPayload.actions',
      ]),
    )
    expect(paths.find((entry) => entry.path === 'proposalPayload.customer')?.container).toBe(false)
    expect(paths.find((entry) => entry.path === 'proposalPayload.customer.flags')?.container).toBe(true)
    expect(paths.find((entry) => entry.path === 'proposalPayload.actions')?.type).toBe('array')
  })

  test('yields nothing without a result kind or a usable schema', () => {
    expect(buildAgentSourcePaths(undefined, nestedOutcome)).toEqual([])
    expect(buildAgentSourcePaths('proposal', undefined)).toEqual([])
    expect(buildAgentSourcePaths('proposal', 'not-a-schema')).toEqual([])
  })
})

describe('isKnownAgentSourcePath', () => {
  const paths = buildAgentSourcePaths('proposal', nestedOutcome)

  test('accepts declared paths and descents into undescribed objects', () => {
    expect(isKnownAgentSourcePath(paths, 'kind')).toBe(true)
    expect(isKnownAgentSourcePath(paths, 'proposalPayload.customer.email')).toBe(true)
    expect(isKnownAgentSourcePath(paths, 'proposalPayload.customer.flags.vip')).toBe(true)
  })

  test('rejects a path the described schema never produces', () => {
    expect(isKnownAgentSourcePath(paths, 'proposalPayload.absent')).toBe(false)
    expect(isKnownAgentSourcePath(paths, 'proposalPayload.customer.phone')).toBe(false)
  })

  test('stays silent on blank paths and on agents with no declared vocabulary', () => {
    expect(isKnownAgentSourcePath(paths, '  ')).toBe(true)
    expect(isKnownAgentSourcePath([], 'anything.at.all')).toBe(true)
  })
})

describe('sample input helpers', () => {
  test('serializes non-string sample values and keeps strings verbatim', () => {
    expect(agentSampleInputRows({ dealId: '{{context.dealId}}', retries: 2, flags: { vip: true } })).toEqual([
      { key: 'dealId', value: '{{context.dealId}}' },
      { key: 'retries', value: '2' },
      { key: 'flags', value: '{"vip":true}' },
    ])
    expect(agentSampleInputRows('nope')).toEqual([])
    expect(agentSampleInputKeys({ a: 1, b: 2 })).toEqual(['a', 'b'])
    expect(agentSampleInputKeys(null)).toEqual([])
  })

  test('detects template expressions', () => {
    expect(isTemplateExpression('{{proposalPayload.score}}')).toBe(true)
    expect(isTemplateExpression('proposalPayload.score')).toBe(false)
  })
})
