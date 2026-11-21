import { asValue, createContainer, InjectionMode } from 'awilix'
import { getProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AiAgentRunReader } from '../lib/agent-run-reader'
import { register } from '../di'

jest.mock('../lib/tool-registry', () => ({ toolRegistry: {} }))
jest.mock('../lib/moderation', () => ({ createModerationService: jest.fn() }))
jest.mock('../lib/decision-model-service', () => ({ createDecisionModelService: jest.fn() }))
jest.mock('../lib/opencode-client', () => ({ createOpenCodeClient: jest.fn() }))
jest.mock('../data/entities', () => ({ AiAgentRun: class {}, AiAgentRunStep: class {}, AiAgentRunToolCall: class {} }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(async () => null), findWithDecryption: jest.fn() }))

it('keeps the merged agent run reader bound to each resolving caller EntityManager', async () => {
  const root = createContainer({ injectionMode: InjectionMode.CLASSIC })
  getProcessDiRegistrar(register)!(root)
  const firstFork = { id: 'first' }
  const secondFork = { id: 'second' }
  const first = root.createScope().register({ em: asValue({ fork: () => firstFork }) })
  const second = root.createScope().register({ em: asValue({ fork: () => secondFork }) })
  const firstReader = first.resolve<AiAgentRunReader>('aiAgentRunReader')
  const secondReader = second.resolve<AiAgentRunReader>('aiAgentRunReader')
  expect(firstReader).not.toBe(secondReader)
  await secondReader.getRun({ tenantId: 'tenant-second', organizationId: 'org-second' }, 'run-second')
  await firstReader.getRun({ tenantId: 'tenant-first', organizationId: 'org-first' }, 'run-first')
  expect(jest.mocked(findOneWithDecryption).mock.calls.map(([em]) => em)).toEqual([secondFork, firstFork])
  await Promise.all([first.dispose(), second.dispose(), root.dispose()])
})
