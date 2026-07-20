import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadMockupFile, writeMockupDocument } from '../loader'
import { mockupDocument, type MockupDocument } from '../schema'
import { createSnapshot, listSnapshots, loadSnapshot } from '../snapshots'

/**
 * Full-document write contract (Phase 2 studio save): dev-mode only, path
 * containment, slug pinning, and `baseHash` optimistic concurrency — a
 * concurrent out-of-band file edit followed by a save MUST hit the 409 path.
 * Plus the snapshot creation/listing contract in the same temp-repo setup.
 */

const FIXTURE = {
  version: 1,
  slug: 'put-fixture',
  title: 'Put fixture',
  root: {
    type: 'stack',
    id: 'root',
    children: [
      { type: 'block', id: 'b-one', entry: 'table', variant: 'default', status: 'proposed' },
    ],
  },
}

function withNodeEnv<T>(value: string, run: () => T): T {
  const previous = process.env.NODE_ENV
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
  try {
    return run()
  } finally {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = previous
  }
}

function makeTempRepo(): { root: string; filePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-mockup-put-'))
  const dir = path.join(root, '.ai', 'mockups')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(root, 'yarn.lock'), '', 'utf8')
  const filePath = path.join(dir, 'put-fixture.mockup.json')
  fs.writeFileSync(filePath, `${JSON.stringify(FIXTURE, null, 2)}\n`, 'utf8')
  return { root, filePath }
}

function editedDocument(): MockupDocument {
  const raw = JSON.parse(JSON.stringify(FIXTURE))
  raw.root.children.push({ type: 'placeholder', id: 'p-new', label: 'New panel', status: 'proposed' })
  return mockupDocument.parse(raw)
}

describe('design_system mockup full-document write', () => {
  it('writes a valid document when baseHash matches', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('development', () =>
        writeMockupDocument(mockup, editedDocument(), mockup.documentHash, root),
      )
      expect(result.ok).toBe(true)
      const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      expect(onDisk.root.children).toHaveLength(2)
      if (result.ok) {
        expect(result.counts).toEqual({ implemented: 0, proposed: 1, omDefault: 0, placeholder: 1 })
        // Returned hash matches a reload of the file.
        expect(loadMockupFile(filePath, 'ai').documentHash).toBe(result.documentHash)
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('409s when the file changed on disk after load (concurrent out-of-band edit)', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      // Out-of-band edit between load and save — an agent editing the JSON.
      const outOfBand = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      outOfBand.title = 'Edited elsewhere'
      fs.writeFileSync(filePath, `${JSON.stringify(outOfBand, null, 2)}\n`, 'utf8')

      const result = withNodeEnv('development', () =>
        writeMockupDocument(mockup, editedDocument(), mockup.documentHash, root),
      )
      expect(result).toMatchObject({ ok: false, status: 409 })
      // The concurrent edit survives untouched.
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).title).toBe('Edited elsewhere')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('is a 404 outside dev mode', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('production', () =>
        writeMockupDocument(mockup, editedDocument(), mockup.documentHash, root),
      )
      expect(result).toMatchObject({ ok: false, status: 404 })
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(FIXTURE)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses paths outside the working tree', () => {
    const { root, filePath } = makeTempRepo()
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-mockup-put-other-'))
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('development', () =>
        writeMockupDocument(mockup, editedDocument(), mockup.documentHash, otherRoot),
      )
      expect(result).toMatchObject({ ok: false, status: 404 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  it('refuses a document whose slug does not match the target', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const foreign = mockupDocument.parse({ ...JSON.parse(JSON.stringify(FIXTURE)), slug: 'other-slug' })
      const result = withNodeEnv('development', () =>
        writeMockupDocument(mockup, foreign, mockup.documentHash, root),
      )
      expect(result).toMatchObject({ ok: false, status: 422 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('design_system mockup snapshots', () => {
  it('creates, lists, and loads a snapshot (byte-identical copy)', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const result = createSnapshot('put-fixture', 'v1', root)
      expect(result.ok).toBe(true)
      expect(listSnapshots('put-fixture', root).map((snapshot) => snapshot.label)).toEqual(['v1'])
      const snapshot = loadSnapshot('put-fixture', 'v1', root)
      expect(snapshot).not.toBeNull()
      expect(snapshot!.issues).toBeNull()
      if (result.ok) {
        expect(fs.readFileSync(result.filePath, 'utf8')).toBe(fs.readFileSync(filePath, 'utf8'))
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses duplicate labels, malformed labels, and unknown slugs', () => {
    const { root } = makeTempRepo()
    try {
      expect(createSnapshot('put-fixture', 'v1', root).ok).toBe(true)
      expect(createSnapshot('put-fixture', 'v1', root)).toMatchObject({ ok: false, status: 409 })
      expect(createSnapshot('put-fixture', 'Bad Label!', root)).toMatchObject({ ok: false, status: 422 })
      expect(createSnapshot('put-fixture', '../escape', root)).toMatchObject({ ok: false, status: 422 })
      expect(createSnapshot('ghost-slug', 'v1', root)).toMatchObject({ ok: false, status: 404 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
