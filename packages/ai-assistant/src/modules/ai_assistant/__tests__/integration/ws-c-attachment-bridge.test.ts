/**
 * Step 3.13 — Phase 1 WS-C integration tests (attachment bridge).
 *
 * Asserts the Step 3.7 attachment-to-model bridge upholds two invariants that
 * matter to every downstream agent turn:
 *
 *   1. Cross-tenant attachment ids passed by the caller are silently dropped —
 *      they MUST NOT surface in the resolved parts array and MUST NOT leak any
 *      metadata about the foreign tenant.
 *   2. An oversized image (> DEFAULT_MAX_INLINE_BYTES = 4 MB) with no
 *      `attachmentSigner` registered falls back to `source: 'metadata-only'`
 *      instead of failing the turn — the model is informed that the file
 *      exists without getting any raw bytes.
 *
 * The underlying `resolveAttachmentParts` implementation is unit-tested in
 * `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/
 * attachment-parts.test.ts`. This integration suite re-exercises the bridge
 * through higher-level fixtures that mimic how the chat dispatcher calls it
 * (two tenants, a signer slot, a real-ish attachment row shape).
 */

import type { AiChatRequestContext } from '../../lib/attachment-bridge-types'
import type { AttachmentSigner } from '../../lib/attachment-parts'

const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class AttachmentStub {},
}))

const resolveAttachmentAbsolutePathMock = jest.fn(
  (_partition: string, storagePath: string) => `/fake/root/${storagePath}`,
)

jest.mock('@open-mercato/core/modules/attachments/lib/storage', () => ({
  resolveAttachmentAbsolutePath: (...args: unknown[]) =>
    resolveAttachmentAbsolutePathMock(...(args as [string, string, string?])),
}))

const fsReadFileMock = jest.fn()
jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: (...args: unknown[]) => fsReadFileMock(...args),
    },
  }
})

import { resolveAttachmentParts } from '../../lib/attachment-parts'

type AttachmentRowOverrides = {
  id?: string
  fileName?: string
  mimeType?: string
  fileSize?: number
  storagePath?: string
  storageDriver?: string
  partitionCode?: string
  tenantId?: string | null
  organizationId?: string | null
  content?: string | null
  entityId?: string
}

function makeRow(overrides: AttachmentRowOverrides = {}): Record<string, unknown> {
  return {
    id: 'attachment-1',
    entityId: 'attachments:attachment',
    fileName: 'file.bin',
    mimeType: 'application/octet-stream',
    fileSize: 1024,
    storagePath: 'path/to/file',
    storageDriver: 'local',
    partitionCode: 'default',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    content: null,
    ...overrides,
  }
}

function makeContainer(options?: { signer?: AttachmentSigner | null; omitEm?: boolean }) {
  const registry: Record<string, unknown> = {}
  if (!options?.omitEm) {
    registry.em = { __label: 'em-stub' }
  }
  if (options?.signer) {
    registry.attachmentSigner = options.signer
  }
  return {
    resolve: jest.fn((name: string) => {
      if (!(name in registry)) {
        throw new Error(`Unknown registration: ${name}`)
      }
      return registry[name] as never
    }),
  } as unknown as Parameters<typeof resolveAttachmentParts>[0]['container']
}

function makeAuth(overrides: Partial<AiChatRequestContext> = {}): AiChatRequestContext {
  return {
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    userId: 'user-a',
    features: [],
    isSuperAdmin: false,
    ...overrides,
  }
}

describe('WS-C integration — attachment bridge', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('drops cross-tenant attachments without leaking foreign metadata', async () => {
    // Simulated tenants: caller is tenant-a; foreign-attachment belongs to tenant-b.
    // findOneWithDecryption accepts the scope tuple but its mock returns the row
    // as-if the query were scope-unaware, so the in-process row scope check is
    // the gate that MUST drop this.
    findOneWithDecryptionMock.mockImplementation(
      async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
        if (where.id === 'own-attachment') {
          return makeRow({ id: 'own-attachment', tenantId: 'tenant-a', organizationId: 'org-a' })
        }
        if (where.id === 'foreign-attachment') {
          // The attachment belongs to tenant-b; the resolver should drop it.
          return makeRow({
            id: 'foreign-attachment',
            tenantId: 'tenant-b',
            organizationId: 'org-b',
            mimeType: 'image/png',
            fileSize: 1024,
          })
        }
        return null
      },
    )
    fsReadFileMock.mockResolvedValue(Buffer.from([1, 2, 3]))

    const auth = makeAuth()
    const parts = await resolveAttachmentParts({
      attachmentIds: ['own-attachment', 'foreign-attachment', 'not-found'],
      authContext: auth,
      container: makeContainer(),
    })

    const ids = parts.map((part) => part.attachmentId)
    expect(ids).toEqual(['own-attachment'])
    expect(ids).not.toContain('foreign-attachment')
    expect(ids).not.toContain('not-found')

    // The warn for the foreign attachment MUST NOT reveal tenant-b or org-b.
    const warnCalls = warnSpy.mock.calls.map((call) => call.join(' '))
    const foreignWarn = warnCalls.find((message) => message.includes('foreign-attachment'))
    expect(foreignWarn).toBeDefined()
    expect(foreignWarn).not.toMatch(/tenant-b/)
    expect(foreignWarn).not.toMatch(/org-b/)
  })

  it('oversized image with no attachment signer falls back to source=metadata-only', async () => {
    findOneWithDecryptionMock.mockResolvedValue(
      makeRow({
        id: 'huge-image',
        tenantId: 'tenant-a',
        organizationId: 'org-a',
        mimeType: 'image/png',
        fileSize: 8 * 1024 * 1024,
      }),
    )

    const parts = await resolveAttachmentParts({
      attachmentIds: ['huge-image'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].attachmentId).toBe('huge-image')
    expect(parts[0].source).toBe('metadata-only')
    // `fs.readFile` MUST NOT be consulted for oversized images — that would
    // blow past the default 4 MB inline ceiling before the downgrade fires.
    expect(fsReadFileMock).not.toHaveBeenCalled()
  })

  it('oversized image WITH a signer is promoted to source=signed-url', async () => {
    findOneWithDecryptionMock.mockResolvedValue(
      makeRow({
        id: 'huge-image',
        tenantId: 'tenant-a',
        organizationId: 'org-a',
        mimeType: 'image/png',
        fileSize: 8 * 1024 * 1024,
      }),
    )
    const signer: AttachmentSigner = {
      sign: jest.fn().mockResolvedValue('https://example.com/signed/huge-image'),
    }

    const parts = await resolveAttachmentParts({
      attachmentIds: ['huge-image'],
      authContext: makeAuth(),
      container: makeContainer({ signer }),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].source).toBe('signed-url')
    expect((parts[0] as { url?: string }).url).toBe('https://example.com/signed/huge-image')
    expect(signer.sign).toHaveBeenCalledTimes(1)
  })

  it('missing DI container returns [] with a warn and never throws', async () => {
    const parts = await resolveAttachmentParts({
      attachmentIds: ['any-id'],
      authContext: makeAuth(),
      // container omitted deliberately
    })
    expect(parts).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
  })
})
