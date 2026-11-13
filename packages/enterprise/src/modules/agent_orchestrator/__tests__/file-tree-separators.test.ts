/**
 * The Files tab rendered flat on Windows: the token walkers built each relative
 * path with `path.join`, so a Windows host emitted `skills\x\SKILL.md`, and the
 * tree builder split on `/` only — one segment, no folders, nothing to expand.
 *
 * Both producers now normalize to `/` (`toPosixRelativePath`), and the builder
 * accepts either separator so an artifact baked by an older generator still
 * renders as a tree without a regenerate.
 */
import { buildFileTree, type FileTreeNode } from '../backend/agents/[id]/components/filesShared'

type SourceFile = Parameters<typeof buildFileTree>[0][number]

function file(path: string): SourceFile {
  return { path, content: '', tokens: 1, inContext: true } as SourceFile
}

function shape(nodes: FileTreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: FileTreeNode[], prefix: string): void => {
    for (const node of list) {
      const label = prefix ? `${prefix}/${node.name}` : node.name
      out.push(`${node.type}:${label}`)
      if (node.children) walk(node.children, label)
    }
  }
  walk(nodes, '')
  return out
}

describe('agent file tree — path separators', () => {
  it('nests POSIX paths into directories', () => {
    const tree = buildFileTree([file('AGENT.md'), file('skills/deal_qualification/SKILL.md')])
    expect(shape(tree)).toEqual([
      'dir:skills',
      'dir:skills/deal_qualification',
      'file:skills/deal_qualification/SKILL.md',
      'file:AGENT.md',
    ])
  })

  it('nests Windows-separated paths identically (the reported bug)', () => {
    const posix = buildFileTree([file('AGENT.md'), file('skills/deal_qualification/SKILL.md')])
    const windows = buildFileTree([file('AGENT.md'), file('skills\\deal_qualification\\SKILL.md')])
    expect(shape(windows)).toEqual(shape(posix))
  })

  it('does not invent a directory from a doubled separator', () => {
    const tree = buildFileTree([file('tools//echo.ts')])
    expect(shape(tree)).toEqual(['dir:tools', 'file:tools/echo.ts'])
  })

  it('keeps a bare filename at the root', () => {
    expect(shape(buildFileTree([file('OUTCOME.md')]))).toEqual(['file:OUTCOME.md'])
  })
})
