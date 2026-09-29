/**
 * Shared, JSX-free helpers for the read-only Files tab: the baked source-file
 * shape, a GitHub-style tree builder (folders first, per-folder token rollup),
 * file-type detection, and frontmatter splitting for the Markdown reader.
 */

export type AgentSourceFile = {
  path: string
  content: string
  tokens: number
  inContext: boolean
}

export type AgentFilesResponse = {
  agentId: string
  files: AgentSourceFile[]
  tokenUsage: { total: number } | null
}

export type FileTreeNode = {
  type: 'dir' | 'file'
  name: string
  /** Full path (files only). */
  path?: string
  file?: AgentSourceFile
  children?: FileTreeNode[]
  /** File: own token count. Dir: sum of in-context descendant tokens. */
  tokens: number
  /** True when the node contributes to the agent's constructed prompt. */
  inContext: boolean
}

export type FileKind = 'md' | 'ts' | 'json' | 'text'

export function fileKind(name: string): FileKind {
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md'
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'ts'
  if (name.endsWith('.json')) return 'json'
  return 'text'
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  md: 'Markdown',
  ts: 'TypeScript',
  json: 'JSON',
  text: 'Text',
}

/**
 * Builds a nested tree from flat file paths. Directories are sorted before files
 * and both alphabetically, mirroring a code host. Each directory carries the sum
 * of its in-context descendants' tokens for the per-folder rollup.
 */
export function buildFileTree(files: AgentSourceFile[]): FileTreeNode[] {
  const roots: FileTreeNode[] = []
  const dirByPath = new Map<string, FileTreeNode>()

  const ensureDir = (segments: string[]): FileTreeNode[] => {
    let siblings = roots
    let prefix = ''
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment
      let dir = dirByPath.get(prefix)
      if (!dir) {
        dir = { type: 'dir', name: segment, children: [], tokens: 0, inContext: false }
        dirByPath.set(prefix, dir)
        siblings.push(dir)
      }
      siblings = dir.children as FileTreeNode[]
    }
    return siblings
  }

  for (const file of files) {
    // Producers emit `/`-separated paths, but an artifact baked on Windows by an
    // older generator carries backslashes. Split on either so a stale
    // `file-agents.generated.ts` still renders as a tree instead of one flat
    // list, and drop empty segments so a doubled separator adds no phantom dir.
    const segments = file.path.split(/[\\/]+/).filter(Boolean)
    const name = segments.pop() as string
    const container = segments.length ? ensureDir(segments) : roots
    container.push({ type: 'file', name, path: file.path, file, tokens: file.tokens, inContext: file.inContext })
    if (file.inContext) {
      let prefix = ''
      for (const segment of segments) {
        prefix = prefix ? `${prefix}/${segment}` : segment
        const dir = dirByPath.get(prefix)
        if (dir) dir.tokens += file.tokens
      }
    }
  }

  const sort = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) if (node.children) sort(node.children)
    return nodes
  }
  return sort(roots)
}

/** Every file path whose path contains the (lower-cased) query, for filtering. */
export function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const walk = (list: FileTreeNode[]): FileTreeNode[] => {
    const out: FileTreeNode[] = []
    for (const node of list) {
      if (node.type === 'file') {
        if (node.path && node.path.toLowerCase().includes(q)) out.push(node)
      } else {
        const kids = walk(node.children ?? [])
        if (kids.length) out.push({ ...node, children: kids })
      }
    }
    return out
  }
  return walk(nodes)
}

/**
 * Splits leading YAML frontmatter (`---\n…\n---`) from a Markdown body so the
 * reader can render it as a labelled key/value block instead of the raw `---`
 * fences react-markdown would turn into thematic breaks.
 */
export function splitFrontmatter(content: string): { frontmatter: Array<{ key: string; value: string }> | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { frontmatter: null, body: content }
  const frontmatter = match[1]
    .split('\n')
    .filter((line) => line.trim() && line.includes(':'))
    .map((line) => {
      const idx = line.indexOf(':')
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() }
    })
  return { frontmatter, body: content.slice(match[0].length) }
}

export function formatBytes(byteLength: number): string {
  return byteLength < 1024 ? `${byteLength} B` : `${(byteLength / 1024).toFixed(1)} KB`
}

/** UTF-8 byte length of a string (not code-point length). */
export function utf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
  return unescape(encodeURIComponent(text)).length
}
