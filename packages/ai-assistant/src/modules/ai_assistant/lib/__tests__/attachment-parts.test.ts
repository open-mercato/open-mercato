/**
 * Step 3.7 — Attachment-to-model conversion bridge.
 *
 * Covers the four source kinds (`bytes`, `signed-url`, `text`,
 * `metadata-only`), the agent `acceptedMediaTypes` whitelist, the cross-
 * tenant drop, and the unavailable-service graceful skip required by the
 * Step brief.
 */

import type { AiAgentAcceptedMediaType } from '../ai-agent-definition'
import type { AiChatRequestContext } from '../attachment-bridge-types'

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

import {
  resolveAttachmentParts,
  resolveAttachmentPartsForAgent,
  attachmentPartsToUiFileParts,
  summarizeAttachmentPartsForPrompt,
  type AttachmentSigner,
} from '../attachment-parts'

function makeAuth(overrides: Partial<AiChatRequestContext> = {}): AiChatRequestContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    features: [],
    isSuperAdmin: false,
    ...overrides,
  }
}

type RowOverrides = {
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

function makeRow(overrides: RowOverrides = {}): Record<string, unknown> {
  return {
    id: 'att-1',
    entityId: 'attachments:attachment',
    fileName: 'file.bin',
    mimeType: 'application/octet-stream',
    fileSize: 1024,
    storagePath: 'path/to/file',
    storageDriver: 'local',
    partitionCode: 'default',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
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
    resolve: (key: string) => {
      if (!(key in registry)) {
        throw new Error(`resolve("${key}") not registered`)
      }
      return registry[key]
    },
  } as unknown as Parameters<typeof resolveAttachmentParts>[0]['container']
}

describe('resolveAttachmentParts — source classification', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.warn as jest.Mock).mockRestore?.()
  })

  it('emits `bytes` for small images (inline fits under the threshold)', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({ id: 'img-1', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 512 }),
    )
    fsReadFileMock.mockResolvedValueOnce(Buffer.from([1, 2, 3, 4]))

    const parts = await resolveAttachmentParts({
      attachmentIds: ['img-1'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].source).toBe('bytes')
    expect(parts[0].attachmentId).toBe('img-1')
    expect(parts[0].mediaType).toBe('image/jpeg')
    expect(parts[0].data).toBeInstanceOf(Uint8Array)
    expect(Array.from(parts[0].data as Uint8Array)).toEqual([1, 2, 3, 4])
  })

  it('emits `signed-url` for oversized images when the container provides an attachmentSigner', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({ id: 'img-2', fileName: 'huge.png', mimeType: 'image/png', fileSize: 50 * 1024 * 1024 }),
    )
    const signer: AttachmentSigner = {
      sign: jest.fn(async () => 'https://signed.example/huge.png?sig=abc'),
    }

    const parts = await resolveAttachmentParts({
      attachmentIds: ['img-2'],
      authContext: makeAuth(),
      container: makeContainer({ signer }),
    })

    expect(signer.sign).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: 'img-2', mediaType: 'image/png' }),
    )
    expect(parts).toHaveLength(1)
    expect(parts[0].source).toBe('signed-url')
    expect(parts[0].url).toBe('https://signed.example/huge.png?sig=abc')
    expect(fsReadFileMock).not.toHaveBeenCalled()
  })

  it('emits `text` for text-like files with extracted content', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({
        id: 'txt-1',
        fileName: 'notes.md',
        mimeType: 'text/markdown',
        fileSize: 42,
        content: '# Notes\n- bullet a\n- bullet b',
      }),
    )

    const parts = await resolveAttachmentParts({
      attachmentIds: ['txt-1'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].source).toBe('text')
    expect(parts[0].textContent).toContain('bullet a')
    // text branch MUST NOT read bytes from disk
    expect(fsReadFileMock).not.toHaveBeenCalled()
  })

  it('emits `metadata-only` for generic binary files without extracted text', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({
        id: 'bin-1',
        fileName: 'archive.zip',
        mimeType: 'application/zip',
        fileSize: 9999,
        content: null,
      }),
    )

    const parts = await resolveAttachmentParts({
      attachmentIds: ['bin-1'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].source).toBe('metadata-only')
    expect(parts[0].data).toBeUndefined()
    expect(parts[0].textContent).toBeUndefined()
    expect(parts[0].url).toBeUndefined()
  })

  it('downgrades images to `metadata-only` when disk read fails and no signer is configured', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({ id: 'img-3', fileName: 'bad.jpg', mimeType: 'image/jpeg', fileSize: 256 }),
    )
    fsReadFileMock.mockRejectedValueOnce(new Error('ENOENT'))

    const parts = await resolveAttachmentParts({
      attachmentIds: ['img-3'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].source).toBe('metadata-only')
  })
})

describe('resolveAttachmentParts — acceptedMediaTypes whitelist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.warn as jest.Mock).mockRestore?.()
  })

  it('drops parts whose classified type is not in the agent whitelist', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(
        makeRow({ id: 'img-1', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 128 }),
      )
      .mockResolvedValueOnce(
        makeRow({ id: 'pdf-1', fileName: 'invoice.pdf', mimeType: 'application/pdf', fileSize: 256 }),
      )
      .mockResolvedValueOnce(
        makeRow({ id: 'bin-1', fileName: 'archive.zip', mimeType: 'application/zip', fileSize: 999 }),
      )
    fsReadFileMock
      .mockResolvedValueOnce(Buffer.from([1, 2]))
      .mockResolvedValueOnce(Buffer.from([3, 4]))

    const acceptedMediaTypes: AiAgentAcceptedMediaType[] = ['image', 'pdf']
    const parts = await resolveAttachmentParts({
      attachmentIds: ['img-1', 'pdf-1', 'bin-1'],
      authContext: makeAuth(),
      acceptedMediaTypes,
      container: makeContainer(),
    })

    expect(parts.map((part) => part.attachmentId)).toEqual(['img-1', 'pdf-1'])
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('bin-1'),
    )
  })

  it('omits the whitelist filter entirely when acceptedMediaTypes is undefined', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(
        makeRow({ id: 'bin-1', fileName: 'archive.zip', mimeType: 'application/zip', fileSize: 999 }),
      )

    const parts = await resolveAttachmentParts({
      attachmentIds: ['bin-1'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].attachmentId).toBe('bin-1')
  })
})

describe('resolveAttachmentParts — tenant / org scope enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.warn as jest.Mock).mockRestore?.()
  })

  it('drops records that belong to a different tenant (non super-admin)', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({
        id: 'cross-1',
        tenantId: 'tenant-OTHER',
        organizationId: 'org-OTHER',
        mimeType: 'image/png',
        fileSize: 64,
      }),
    )

    const parts = await resolveAttachmentParts({
      attachmentIds: ['cross-1'],
      authContext: makeAuth({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      container: makeContainer(),
    })

    expect(parts).toEqual([])
    expect(fsReadFileMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('out of scope'))
  })

  it('lets super-admin callers through regardless of tenant scope', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({
        id: 'cross-2',
        tenantId: 'tenant-OTHER',
        organizationId: 'org-OTHER',
        mimeType: 'application/zip',
        fileSize: 64,
        content: null,
      }),
    )

    const parts = await resolveAttachmentParts({
      attachmentIds: ['cross-2'],
      authContext: makeAuth({ isSuperAdmin: true }),
      container: makeContainer(),
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].attachmentId).toBe('cross-2')
  })

  it('drops ids that do not resolve to a record', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)

    const parts = await resolveAttachmentParts({
      attachmentIds: ['missing-1'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found'))
  })
})

describe('resolveAttachmentParts — unavailable service graceful skip', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.warn as jest.Mock).mockRestore?.()
  })

  it('returns [] without throwing when no container is provided', async () => {
    const parts = await resolveAttachmentParts({
      attachmentIds: ['att-1'],
      authContext: makeAuth(),
    })

    expect(parts).toEqual([])
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('without a DI container'))
  })

  it('returns [] without throwing when the container cannot resolve `em`', async () => {
    const parts = await resolveAttachmentParts({
      attachmentIds: ['att-1'],
      authContext: makeAuth(),
      container: makeContainer({ omitEm: true }),
    })

    expect(parts).toEqual([])
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] without throwing when attachmentIds is empty', async () => {
    const parts = await resolveAttachmentParts({
      attachmentIds: [],
      authContext: makeAuth(),
      container: makeContainer(),
    })
    expect(parts).toEqual([])
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })
})

describe('resolveAttachmentPartsForAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.warn as jest.Mock).mockRestore?.()
  })

  it('threads the agent acceptedMediaTypes into the resolver', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      makeRow({ id: 'bin-2', fileName: 'x.zip', mimeType: 'application/zip', fileSize: 1 }),
    )

    const parts = await resolveAttachmentPartsForAgent({
      agent: {
        id: 'customers.assistant',
        moduleId: 'customers',
        label: 'x',
        description: 'x',
        systemPrompt: 'x',
        allowedTools: [],
        acceptedMediaTypes: ['image', 'pdf'],
      },
      attachmentIds: ['bin-2'],
      authContext: makeAuth(),
      container: makeContainer(),
    })

    expect(parts).toEqual([])
  })

  it('short-circuits when attachmentIds is undefined or empty', async () => {
    const noIds = await resolveAttachmentPartsForAgent({
      agent: {
        id: 'a.b',
        moduleId: 'a',
        label: 'x',
        description: 'x',
        systemPrompt: 'x',
        allowedTools: [],
      },
      attachmentIds: undefined,
      authContext: makeAuth(),
      container: makeContainer(),
    })
    expect(noIds).toEqual([])

    const emptyIds = await resolveAttachmentPartsForAgent({
      agent: {
        id: 'a.b',
        moduleId: 'a',
        label: 'x',
        description: 'x',
        systemPrompt: 'x',
        allowedTools: [],
      },
      attachmentIds: [],
      authContext: makeAuth(),
      container: makeContainer(),
    })
    expect(emptyIds).toEqual([])
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })
})

describe('attachmentPartsToUiFileParts', () => {
  it('emits a `type: file` part with a data URL for bytes sources', () => {
    const parts = attachmentPartsToUiFileParts([
      {
        attachmentId: 'a',
        fileName: 'photo.png',
        mediaType: 'image/png',
        source: 'bytes',
        data: new Uint8Array([1, 2, 3]),
      },
    ])
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe('file')
    expect(parts[0].mediaType).toBe('image/png')
    expect(parts[0].filename).toBe('photo.png')
    expect(parts[0].url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('emits a `type: file` part with the raw URL for signed-url sources', () => {
    const parts = attachmentPartsToUiFileParts([
      {
        attachmentId: 'b',
        fileName: 'invoice.pdf',
        mediaType: 'application/pdf',
        source: 'signed-url',
        url: 'https://signed.example/invoice.pdf',
      },
    ])
    expect(parts).toHaveLength(1)
    expect(parts[0].url).toBe('https://signed.example/invoice.pdf')
  })

  it('drops text and metadata-only sources (surfaced via the system prompt instead)', () => {
    const parts = attachmentPartsToUiFileParts([
      { attachmentId: 'c', fileName: 'n.md', mediaType: 'text/markdown', source: 'text', textContent: 'hi' },
      { attachmentId: 'd', fileName: 'm.bin', mediaType: 'application/octet-stream', source: 'metadata-only' },
    ])
    expect(parts).toEqual([])
  })
})

describe('summarizeAttachmentPartsForPrompt', () => {
  it('returns null for empty inputs', () => {
    expect(summarizeAttachmentPartsForPrompt([])).toBeNull()
  })

  it('includes the extracted text for text sources', () => {
    const summary = summarizeAttachmentPartsForPrompt([
      {
        attachmentId: 'a',
        fileName: 'notes.md',
        mediaType: 'text/markdown',
        source: 'text',
        textContent: '# Notes',
      },
      {
        attachmentId: 'b',
        fileName: 'photo.png',
        mediaType: 'image/png',
        source: 'bytes',
      },
    ])
    expect(summary).toContain('[ATTACHMENTS]')
    expect(summary).toContain('notes.md')
    expect(summary).toContain('# Notes')
    expect(summary).toContain('photo.png')
  })
})
