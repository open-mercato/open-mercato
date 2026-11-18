import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockAssertCapability = jest.fn(async (..._args: unknown[]) => [] as string[])

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCapability: (...args: unknown[]) => mockAssertCapability(...args),
  }
})

import { getWorkflowSafeCommand } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import {
  UNSET_WORKFLOW_COMMAND_POLICY,
  isWorkflowCommandEnabled,
} from '@open-mercato/core/modules/workflows/lib/workflow-command-enablement'
import workflowsConfig from '../workflows'
import { ingestFindingsCommand } from '../commands/findings'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const WORKFLOW_USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

function workflowContext(): CommandRuntimeContext {
  const em = {} as EntityManager
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : null) } as CommandRuntimeContext['container'],
    auth: {
      sub: WORKFLOW_USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      isSuperAdmin: false,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
}

const ingestInput = {
  documentId: DOCUMENT_ID,
  playbookCode: 'nda',
  source: 'ai' as const,
  origin: { workflowInstanceId: 'wf-instance-1' },
  findings: [{
    severity: 'blocking' as const,
    title: 'Term too long',
    explanation: 'Exceeds the playbook position.',
    quote: 'five years',
  }],
}

describe('documents workflow integration', () => {
  beforeEach(() => {
    mockAssertCapability.mockReset()
    mockAssertCapability.mockResolvedValue([])
  })

  it('declares the module workflows config without bundled definitions', () => {
    expect(workflowsConfig.moduleId).toBe('documents')
    expect(workflowsConfig.workflows).toEqual([])
  })

  it('registers finding ingest as an opt-in workflow-safe command gated on documents.edit', () => {
    const command = getWorkflowSafeCommand('documents.finding.ingest')
    expect(command).toEqual({
      commandId: 'documents.finding.ingest',
      requiredFeatures: ['documents.edit'],
      labelKey: 'documents.workflows.commands.finding.ingest',
    })
    expect(command?.defaultEnabled).toBeUndefined()
  })

  it('keeps the command off for a tenant that never enabled it', () => {
    const command = getWorkflowSafeCommand('documents.finding.ingest')
    expect(command).not.toBeNull()
    if (!command) return
    expect(isWorkflowCommandEnabled(command, UNSET_WORKFLOW_COMMAND_POLICY)).toBe(false)
    expect(isWorkflowCommandEnabled(command, { enabledCommandIds: ['documents.finding.ingest'] })).toBe(true)
  })

  it('checks the editor capability of the workflow user on the target document', async () => {
    await ingestFindingsCommand.prepare?.(ingestInput, workflowContext())
    expect(mockAssertCapability).toHaveBeenCalledTimes(1)
    const [, , documentId, scope, capability] = mockAssertCapability.mock.calls[0] ?? []
    expect(documentId).toBe(DOCUMENT_ID)
    expect(scope).toEqual(expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }))
    expect(capability).toBe('canEdit')
  })

  it('refuses the ingest when the workflow user is below the editor tier', async () => {
    mockAssertCapability.mockRejectedValue(new CrudHttpError(403, { error: 'Forbidden' }))
    await expect(ingestFindingsCommand.prepare?.(ingestInput, workflowContext())).rejects.toBeInstanceOf(CrudHttpError)
  })
})
