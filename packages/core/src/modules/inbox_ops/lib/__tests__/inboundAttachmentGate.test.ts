/** @jest-environment node */

const mockWarn = jest.fn()
const mockListUnguardedAttachmentReaders = jest.fn((): string[] => [])

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    warn: (...args: unknown[]) => mockWarn(...args),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  }
  return { createLogger: () => logger }
})

jest.mock('@open-mercato/core/modules/attachments', () => ({
  listUnguardedAttachmentReaders: () => mockListUnguardedAttachmentReaders(),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  isInboundAttachmentIngestEnabled,
  isUnguardedReaderTestOptOutActive,
  resetInboundAttachmentGateWarningsForTests,
  unguardedAttachmentReadersBlockingIngest,
  warnIfStoredInboundAttachmentsReadableByUnguardedReaders,
} from '../inboundAttachments'

const closedConfig = { enabled: true, allowUnguardedReaders: false, resendStubEnabled: false }

function warnings(): string[] {
  return mockWarn.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  mockWarn.mockReset()
  mockListUnguardedAttachmentReaders.mockReset()
  mockListUnguardedAttachmentReaders.mockReturnValue([])
  resetInboundAttachmentGateWarningsForTests()
})

describe('unguardedAttachmentReadersBlockingIngest', () => {
  it('returns the unguarded readers of the attachments module and warns once per process naming them', () => {
    mockListUnguardedAttachmentReaders.mockReturnValue(['agent_orchestrator'])
    expect(unguardedAttachmentReadersBlockingIngest({ config: closedConfig })).toEqual(['agent_orchestrator'])
    expect(unguardedAttachmentReadersBlockingIngest({ config: closedConfig })).toEqual(['agent_orchestrator'])
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][1]).toEqual({ modules: ['agent_orchestrator'] })
  })

  it('returns nothing and stays silent when no reader is unguarded (ingestion resumes once it declares)', () => {
    mockListUnguardedAttachmentReaders.mockReturnValueOnce(['agent_orchestrator']).mockReturnValue([])
    expect(unguardedAttachmentReadersBlockingIngest({ config: closedConfig })).toHaveLength(1)
    expect(unguardedAttachmentReadersBlockingIngest({ config: closedConfig })).toEqual([])
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('honors the test opt-out only with both test flags, and warns about it', () => {
    mockListUnguardedAttachmentReaders.mockReturnValue(['agent_orchestrator'])
    expect(unguardedAttachmentReadersBlockingIngest({ config: { ...closedConfig, allowUnguardedReaders: true } })).toEqual(['agent_orchestrator'])
    expect(unguardedAttachmentReadersBlockingIngest({ config: { ...closedConfig, resendStubEnabled: true } })).toEqual(['agent_orchestrator'])
    expect(unguardedAttachmentReadersBlockingIngest({ config: { ...closedConfig, allowUnguardedReaders: true, resendStubEnabled: true } })).toEqual([])
    expect(warnings().some((message) => message.includes('test only'))).toBe(true)
    expect(isUnguardedReaderTestOptOutActive({ allowUnguardedReaders: true, resendStubEnabled: false })).toBe(false)
    expect(isUnguardedReaderTestOptOutActive({ allowUnguardedReaders: true, resendStubEnabled: true })).toBe(true)
  })

  it('reads the opt-out from the environment by default', () => {
    mockListUnguardedAttachmentReaders.mockReturnValue(['agent_orchestrator'])
    const previous = { ...process.env }
    try {
      process.env.INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS = 'true'
      delete process.env.OM_ENABLE_RESEND_STUB
      expect(unguardedAttachmentReadersBlockingIngest()).toEqual(['agent_orchestrator'])
      process.env.OM_ENABLE_RESEND_STUB = 'true'
      expect(unguardedAttachmentReadersBlockingIngest()).toEqual([])
    } finally {
      process.env = previous
    }
  })
})

describe('isInboundAttachmentIngestEnabled', () => {
  it('checks the kill switch first, without consulting the gate', () => {
    mockListUnguardedAttachmentReaders.mockReturnValue(['agent_orchestrator'])
    expect(isInboundAttachmentIngestEnabled({ config: { ...closedConfig, enabled: false } })).toBe(false)
    expect(mockListUnguardedAttachmentReaders).not.toHaveBeenCalled()
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('is off while an unguarded reader is enabled and on otherwise', () => {
    mockListUnguardedAttachmentReaders.mockReturnValue(['agent_orchestrator'])
    expect(isInboundAttachmentIngestEnabled({ config: closedConfig })).toBe(false)
    mockListUnguardedAttachmentReaders.mockReturnValue([])
    expect(isInboundAttachmentIngestEnabled({ config: closedConfig })).toBe(true)
  })
})

describe('warnIfStoredInboundAttachmentsReadableByUnguardedReaders', () => {
  function emWithStoredRows(found: boolean) {
    const execute = jest.fn(async () => (found ? [{ found: 1 }] : []))
    return { em: { getConnection: () => ({ execute }) } as unknown as EntityManager, execute }
  }

  it('warns once per process while stored rows and an unguarded reader coexist', async () => {
    const { em, execute } = emWithStoredRows(true)
    expect(await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(em, ['agent_orchestrator'])).toBe(true)
    expect(await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(em, ['agent_orchestrator'])).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(warnings().filter((message) => message.includes('readable through'))).toHaveLength(1)
  })

  it('stays silent without a reader or without stored rows, and re-checks only after a while', async () => {
    const { em, execute } = emWithStoredRows(false)
    expect(await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(em, [])).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    const start = new Date('2026-11-08T10:00:00.000Z')
    expect(await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(em, ['agent_orchestrator'], () => start)).toBe(false)
    expect(await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(em, ['agent_orchestrator'], () => new Date(start.getTime() + 60_000))).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(em, ['agent_orchestrator'], () => new Date(start.getTime() + 6 * 60_000))).toBe(false)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
