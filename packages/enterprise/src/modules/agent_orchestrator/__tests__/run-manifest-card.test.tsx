/**
 * @jest-environment jsdom
 */

import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RunManifestCard, findRunManifest, shortenHash } from '../components/RunManifestCard'
import type { SpanView } from '../components/types'

const DEFINITION_HASH = 'sha256:abcdef0123456789fedcba'
const TOOLS_HASH = 'sha256:0011223344556677889900'

function span(overrides: Partial<SpanView>): SpanView {
  return {
    id: 'span-1',
    externalSpanId: 'run-1:manifest',
    parentSpanId: null,
    sequence: 0,
    name: 'run.manifest',
    kind: 'system',
    startedAt: '2026-10-26T10:00:00.000Z',
    endedAt: '2026-10-26T10:00:00.000Z',
    durationMs: 0,
    status: 'ok',
    attributes: null,
    ...overrides,
  }
}

const MANIFEST_ATTRIBUTES = {
  'om.manifest.version': 1,
  'om.runtime': 'native',
  'om.agent.id': 'claims.triage',
  'om.agent.definition_hash': DEFINITION_HASH,
  'om.agent.source': 'code',
  'om.prompt.override': { id: 'override-7', version: 3 },
  'om.skills': [],
  'om.tools.sha256': TOOLS_HASH,
  'om.tools.names': ['search_claims', 'read_policy'],
  'om.model.declared': 'provider-model-large',
  'om.model.resolved': 'provider-model-large-2026',
  'om.provider': 'example-provider',
  'om.knowledge': { 'policies.handbook': 'v12' },
  'om.invoker': { kind: 'api_key', userId: null, apiKeyId: 'key-42', ownerUserId: 'user-9' },
  'om.entry_point': 'run_api',
  'om.correlation_id': 'corr-123',
  'om.capture': { level: 'metadata', source: 'deployment', retentionDays: 30, redactPii: false },
  'om.manifest.truncated': true,
}

describe('RunManifestCard', () => {
  it('renders the identity fields from the run.manifest span', () => {
    renderWithProviders(
      <RunManifestCard
        spans={[span({ id: 'span-0', name: 'llm.call', kind: 'llm' }), span({ attributes: MANIFEST_ATTRIBUTES })]}
        agentVersion="4"
      />,
    )
    expect(screen.getByText('agent_orchestrator.traces.detail.manifest.title')).not.toBeNull()
    expect(screen.getByText('4')).not.toBeNull()
    expect(screen.getByText(shortenHash(DEFINITION_HASH))).not.toBeNull()
    expect(screen.getByText('native')).not.toBeNull()
    expect(screen.getByText('code')).not.toBeNull()
    expect(screen.getByText('provider-model-large')).not.toBeNull()
    expect(screen.getByText('provider-model-large-2026')).not.toBeNull()
    expect(screen.getByText('example-provider')).not.toBeNull()
    expect(screen.getByText('policies.handbook → v12')).not.toBeNull()
    expect(screen.getByText('api_key')).not.toBeNull()
    expect(screen.getByText(/key-42/)).not.toBeNull()
    expect(screen.getByText('run_api')).not.toBeNull()
    expect(screen.getByText('corr-123')).not.toBeNull()
    expect(screen.getByText('metadata')).not.toBeNull()
    expect(screen.getByText('agent_orchestrator.traces.detail.manifest.truncatedValue')).not.toBeNull()
    expect(screen.getByText('agent_orchestrator.traces.detail.manifest.promptOverrideValue')).not.toBeNull()
    expect(screen.queryByText('agent_orchestrator.traces.detail.manifest.channel')).toBeNull()
    expect(screen.queryByText('agent_orchestrator.traces.detail.manifest.principal')).toBeNull()
    expect(screen.queryByText('agent_orchestrator.traces.detail.manifest.notRecorded')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'agent_orchestrator.traces.detail.manifest.copy' })).toHaveLength(2)
  })

  it('states that nothing was recorded when the run has no manifest span', () => {
    renderWithProviders(
      <RunManifestCard spans={[span({ id: 'span-0', name: 'llm.call', kind: 'llm' })]} agentVersion={null} />,
    )
    expect(screen.getByText('agent_orchestrator.traces.detail.manifest.notRecorded')).not.toBeNull()
    expect(screen.queryByText('agent_orchestrator.traces.detail.manifest.definitionHash')).toBeNull()
  })

  it('ignores malformed fields without dropping the rest of the manifest', () => {
    const manifest = findRunManifest([
      span({ attributes: { ...MANIFEST_ATTRIBUTES, 'om.knowledge': 'broken', 'om.invoker': 7 } }),
    ])
    expect(manifest?.['om.knowledge']).toBeUndefined()
    expect(manifest?.['om.invoker']).toBeUndefined()
    expect(manifest?.['om.agent.definition_hash']).toBe(DEFINITION_HASH)
  })

  it('shortens long hashes and leaves short ones intact', () => {
    expect(shortenHash(DEFINITION_HASH)).toBe('abcdef012345…')
    expect(shortenHash('sha256:short')).toBe('sha256:short')
  })
})
