import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyAnnotationsToDocument,
  draftIntentIssue,
  isPathInside,
  loadMockupFile,
  writeAnnotations,
} from '../loader'

const FIXTURE = {
  version: 1,
  slug: 'annotation-fixture',
  title: 'Annotation fixture',
  root: {
    type: 'stack',
    id: 'root',
    gap: 4,
    children: [
      {
        type: 'block',
        id: 'b-one',
        entry: 'table',
        variant: 'default',
        status: 'proposed',
        userStory: 'US-9',
        note: 'original note',
      },
      { type: 'placeholder', id: 'p-two', label: 'Panel', status: 'proposed' },
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-mockup-annotations-'))
  const dir = path.join(root, '.ai', 'mockups')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'annotation-fixture.mockup.json')
  fs.writeFileSync(filePath, `${JSON.stringify(FIXTURE, null, 2)}\n`, 'utf8')
  return { root, filePath }
}

describe('design_system mockup annotation write-back', () => {
  it('isPathInside accepts children and rejects escapes', () => {
    expect(isPathInside('/repo/.ai/mockups/a.mockup.json', '/repo')).toBe(true)
    expect(isPathInside('/repo/../outside/a.mockup.json', '/repo')).toBe(false)
    expect(isPathInside('/elsewhere/a.mockup.json', '/repo')).toBe(false)
    expect(isPathInside('/repo', '/repo')).toBe(false)
  })

  it('rewrites only annotation fields and reports unknown ids', () => {
    const raw = JSON.parse(JSON.stringify(FIXTURE))
    const { unknownIds } = applyAnnotationsToDocument(raw, [
      { id: 'b-one', status: 'implemented', userStory: 'US-10' }, // note omitted → removed
      { id: 'b-ghost', status: 'implemented' },
    ])
    expect(unknownIds).toEqual(['b-ghost'])
    const block = raw.root.children[0]
    expect(block.status).toBe('implemented')
    expect(block.userStory).toBe('US-10')
    expect(block.note).toBeUndefined()
    // Layout, entry, and variant untouched.
    expect(block.entry).toBe('table')
    expect(block.variant).toBe('default')
    expect(raw.root.gap).toBe(4)
    expect(raw.root.children[1]).toEqual(FIXTURE.root.children[1])
  })

  it('writes annotations to disk in dev mode (temp fixture)', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('development', () =>
        writeAnnotations(mockup, [{ id: 'p-two', status: 'om-default', note: 'now stock' }], root),
      )
      expect(result.ok).toBe(true)
      const rewritten = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      expect(rewritten.root.children[1].status).toBe('om-default')
      expect(rewritten.root.children[1].note).toBe('now stock')
      expect(rewritten.root.children[0]).toEqual(FIXTURE.root.children[0])
      if (result.ok) {
        expect(result.counts).toEqual({ implemented: 0, proposed: 1, omDefault: 0, placeholder: 1 })
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses paths outside the working tree', () => {
    const { root, filePath } = makeTempRepo()
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-mockup-other-'))
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('development', () =>
        writeAnnotations(mockup, [{ id: 'b-one', status: 'implemented' }], otherRoot),
      )
      expect(result).toMatchObject({ ok: false, status: 404 })
      // File untouched.
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(FIXTURE)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  it('is a 404 outside dev mode', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('production', () =>
        writeAnnotations(mockup, [{ id: 'b-one', status: 'implemented' }], root),
      )
      expect(result).toMatchObject({ ok: false, status: 404 })
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(FIXTURE)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects unknown block ids with 422', () => {
    const { root, filePath } = makeTempRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('development', () =>
        writeAnnotations(mockup, [{ id: 'nope', status: 'implemented' }], root),
      )
      expect(result).toMatchObject({ ok: false, status: 422 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('design_system draft finalize (never auto-final)', () => {
  const DRAFT_FIXTURE = { ...FIXTURE, slug: 'annotation-fixture', draft: true }

  function makeDraftRepo(): { root: string; filePath: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-mockup-draft-'))
    const dir = path.join(root, '.ai', 'mockups')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'annotation-fixture.mockup.json')
    fs.writeFileSync(filePath, `${JSON.stringify(DRAFT_FIXTURE, null, 2)}\n`, 'utf8')
    return { root, filePath }
  }

  it('draftIntentIssue rejects draft-flag changes without the explicit finalize intent', () => {
    // Plain annotation writes never touch the flag.
    expect(draftIntentIssue({})).toBeNull()
    // draft: false without finalize is exactly the auto-final path — rejected.
    expect(draftIntentIssue({ draft: false })).toContain('finalize')
    // Re-drafting is a document edit, not an annotation write.
    expect(draftIntentIssue({ draft: true })).toContain('not supported')
    expect(draftIntentIssue({ draft: true, finalize: true })).toContain('not supported')
    // finalize must be literally true.
    expect(draftIntentIssue({ finalize: false })).toContain('finalize')
    // The one legal shape: an explicit finalize (with or without draft: false).
    expect(draftIntentIssue({ finalize: true })).toBeNull()
    expect(draftIntentIssue({ draft: false, finalize: true })).toBeNull()
  })

  it('annotation writes WITHOUT finalize leave the draft flag untouched', () => {
    const { root, filePath } = makeDraftRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      expect(mockup.draft).toBe(true)
      const result = withNodeEnv('development', () =>
        writeAnnotations(mockup, [{ id: 'b-one', status: 'implemented' }], root),
      )
      expect(result.ok).toBe(true)
      const rewritten = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      expect(rewritten.draft).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('the explicit finalize intent clears the flag (and only then)', () => {
    const { root, filePath } = makeDraftRepo()
    try {
      const mockup = loadMockupFile(filePath, 'ai')
      const result = withNodeEnv('development', () =>
        writeAnnotations(mockup, [], root, undefined, true),
      )
      expect(result.ok).toBe(true)
      const rewritten = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      expect(rewritten.draft).toBeUndefined()
      expect(loadMockupFile(filePath, 'ai').draft).toBe(false)
      // Everything else untouched.
      expect(rewritten.root).toEqual(DRAFT_FIXTURE.root)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('applyAnnotationsToDocument never drops the flag unless finalize is passed', () => {
    const raw = JSON.parse(JSON.stringify(DRAFT_FIXTURE))
    applyAnnotationsToDocument(raw, [{ id: 'b-one', status: 'implemented' }])
    expect(raw.draft).toBe(true)
    applyAnnotationsToDocument(raw, [], undefined, true)
    expect(raw.draft).toBeUndefined()
  })
})
