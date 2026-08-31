"use client"

import * as React from 'react'
import { ChevronRight, Folder, FileText, FileJson, FileCode2, File as FileIcon, Lock, GitBranch, Coins, Copy } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatNumber, type AgentDetailView } from '../../../../components/types'
import { runtimeDisplayLabel } from '../../../../components/runtimeLabel'
import {
  buildFileTree,
  filterTree,
  fileKind,
  FILE_KIND_LABEL,
  formatBytes,
  splitFrontmatter,
  utf8Bytes,
  type AgentFilesResponse,
  type AgentSourceFile,
  type FileTreeNode,
} from './filesShared'

type FilesTabProps = {
  agentId: string
  agent: AgentDetailView
  active: boolean
}

function FileGlyph({ name }: { name: string }) {
  const kind = fileKind(name)
  const className = 'size-4 shrink-0 text-muted-foreground'
  if (kind === 'md') return <FileText className={className} />
  if (kind === 'json') return <FileJson className={className} />
  if (kind === 'ts') return <FileCode2 className={className} />
  return <FileIcon className={className} />
}

function CodeView({ content }: { content: string }) {
  const body = content.replace(/\n$/, '')
  const lineCount = body.split('\n').length
  const gutter = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')
  return (
    <div className="flex font-mono text-sm">
      <pre aria-hidden className="select-none border-r border-border bg-muted/40 px-3 py-4 text-right text-muted-foreground">{gutter}</pre>
      <pre className="flex-1 overflow-x-auto px-4 py-4 text-foreground">{body}</pre>
    </div>
  )
}

function FileReader({ file }: { file: AgentSourceFile }) {
  const t = useT()
  const locale = useLocale()
  const [view, setView] = React.useState<'preview' | 'raw'>('preview')
  React.useEffect(() => { setView('preview') }, [file.path])

  const kind = fileKind(file.path.split('/').pop() as string)
  const segments = file.path.split('/')
  const leaf = segments[segments.length - 1]
  const lineCount = file.content.replace(/\n$/, '').split('\n').length
  const meta = file.inContext
    ? `${FILE_KIND_LABEL[kind]} · ${lineCount} ${t('agent_orchestrator.files.lines', 'lines')} · ${formatBytes(utf8Bytes(file.content))} · ~${formatNumber(file.tokens, locale)} ${t('agent_orchestrator.files.tokens', 'tokens')}`
    : `${FILE_KIND_LABEL[kind]} · ${lineCount} ${t('agent_orchestrator.files.lines', 'lines')} · ${formatBytes(utf8Bytes(file.content))} · ${t('agent_orchestrator.files.notInContext', 'not in model context')}`

  const copy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(file.content).then(
      () => flash(t('agent_orchestrator.files.copied', 'File copied to clipboard.'), 'success'),
      () => flash(t('agent_orchestrator.files.copyFailed', 'Could not copy to clipboard.'), 'error'),
    )
  }

  const { frontmatter, body } = kind === 'md' ? splitFrontmatter(file.content) : { frontmatter: null, body: file.content }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 font-mono text-sm">
          <span className="text-muted-foreground">{agentRoot(segments)}</span>
          <span className="font-medium text-foreground">{leaf}</span>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{meta}</span>
        {kind === 'md' ? (
          <SegmentedControl value={view} onValueChange={(value) => setView(value as 'preview' | 'raw')} aria-label={t('agent_orchestrator.files.viewToggle', 'File view')}>
            <SegmentedControlItem value="preview">{t('agent_orchestrator.files.preview', 'Preview')}</SegmentedControlItem>
            <SegmentedControlItem value="raw">{t('agent_orchestrator.files.raw', 'Raw')}</SegmentedControlItem>
          </SegmentedControl>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <Copy className="mr-1.5 size-3.5" />
          {t('agent_orchestrator.files.copy', 'Copy')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {kind === 'md' && view === 'preview' ? (
          <div className="px-6 py-5">
            {frontmatter && frontmatter.length ? (
              <dl className="mb-5 grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
                {frontmatter.map((row) => (
                  <React.Fragment key={row.key}>
                    <dt className="text-muted-foreground">{row.key}</dt>
                    <dd className="break-words text-foreground">{row.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : null}
            <MarkdownContent body={body} format="markdown" className="text-sm leading-relaxed" />
          </div>
        ) : (
          <CodeView content={file.content} />
        )}
      </div>
    </div>
  )
}

function agentRoot(segments: string[]): string {
  if (segments.length <= 1) return ''
  return `${segments.slice(0, -1).join('/')}/`
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  locale,
}: {
  node: FileTreeNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  locale: string
}) {
  const t = useT()
  const [open, setOpen] = React.useState(true)
  const pad = { paddingLeft: `${6 + depth * 16}px` }
  if (node.type === 'file') {
    const selected = selectedPath === node.path
    return (
      <button
        type="button"
        onClick={() => node.path && onSelect(node.path)}
        style={pad}
        className={`flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm ${selected ? 'bg-brand-violet/10 font-medium text-brand-violet' : 'text-foreground hover:bg-accent'}`}
      >
        <span className="w-3.5 shrink-0" />
        <FileGlyph name={node.name} />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 pl-2 font-mono text-xs tabular-nums text-muted-foreground">
          {node.inContext ? formatNumber(node.tokens, locale) : t('agent_orchestrator.files.sample', 'sample')}
        </span>
      </button>
    )
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={pad}
        className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm text-foreground hover:bg-accent"
      >
        <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
        {node.tokens > 0 ? (
          <span className="ml-auto shrink-0 pl-2 font-mono text-xs tabular-nums text-muted-foreground opacity-70">{formatNumber(node.tokens, locale)}</span>
        ) : null}
      </button>
      {open ? (
        <div>
          {(node.children ?? []).map((child) => (
            <TreeNode key={child.path ?? child.name} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} locale={locale} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DefinitionOverview({ agent }: { agent: AgentDetailView }) {
  const t = useT()
  const locale = useLocale()
  const defaultValue = t('agent_orchestrator.agentDetail.defaultValue', 'Default')
  const items: Array<{ key: string; value: string; mono?: boolean }> = [
    { key: t('agent_orchestrator.agentDetail.config.runtimeKind', 'Runtime'), value: `${runtimeDisplayLabel(t, agent.runtime, agent.runtimeMode)} · ${t('agent_orchestrator.files.fileDefined', 'file-defined')}` },
    { key: t('agent_orchestrator.agentDetail.fields.provider', 'Provider'), value: agent.defaultProvider ?? defaultValue, mono: true },
    { key: t('agent_orchestrator.agentDetail.fields.model', 'Model'), value: agent.defaultModel ?? defaultValue, mono: true },
    { key: t('agent_orchestrator.agentDetail.fields.maxSteps', 'Max steps'), value: agent.loopMaxSteps != null ? String(agent.loopMaxSteps) : defaultValue },
    { key: t('agent_orchestrator.agentDetail.config.resultKind', 'Result kind'), value: agent.resultKind },
  ]
  if (agent.tokenUsage) {
    items.push({ key: t('agent_orchestrator.files.contextEstimate', 'Context estimate'), value: `~${formatNumber(agent.tokenUsage.total, locale)} ${t('agent_orchestrator.files.tokens', 'tokens')}` })
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-muted/30 px-4 py-3">
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-0.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{item.key}</span>
          <span className={`text-sm font-semibold ${item.mono ? 'font-mono font-medium' : ''}`}>{item.value}</span>
        </div>
      ))}
      {agent.tools.length ? <ChipGroup label={t('agent_orchestrator.agentDetail.fields.tools', 'Tools')} values={agent.tools} /> : null}
      {agent.skills.length ? <ChipGroup label={t('agent_orchestrator.agentDetail.fields.skills', 'Skills')} values={agent.skills} /> : null}
      {agent.subAgents.length ? <ChipGroup label={t('agent_orchestrator.agentDetail.fields.subAgents', 'Sub-agents')} values={agent.subAgents} /> : null}
    </div>
  )
}

function ChipGroup({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {values.map((value) => <Tag key={value} variant="neutral">{value}</Tag>)}
    </div>
  )
}

export function FilesTab({ agentId, agent, active }: FilesTabProps) {
  const t = useT()
  const locale = useLocale()
  const [files, setFiles] = React.useState<AgentSourceFile[] | null>(null)
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')
  // Dedupe by agent id (survives React's dev double-invoke) instead of a
  // cleanup-cancel guard, which would drop the sole in-flight fetch on remount.
  const loadedForRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!active || loadedForRef.current === agentId) return
    loadedForRef.current = agentId
    setState('loading')
    apiCall<AgentFilesResponse>(`/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/files`)
      .then((call) => {
        if (loadedForRef.current !== agentId) return
        if (!call.ok || !call.result) {
          setState('error')
          return
        }
        const items = call.result.files ?? []
        setFiles(items)
        const preferred = items.find((f) => f.path === 'AGENT.md') ?? items[0]
        setSelectedPath(preferred ? preferred.path : null)
        setState('ready')
      })
      .catch(() => { if (loadedForRef.current === agentId) setState('error') })
  }, [active, agentId])

  const tree = React.useMemo(() => (files ? buildFileTree(files) : []), [files])
  const visibleTree = React.useMemo(() => filterTree(tree, filter), [tree, filter])
  const selectedFile = React.useMemo(
    () => (files && selectedPath ? files.find((f) => f.path === selectedPath) ?? null : null),
    [files, selectedPath],
  )
  const contextTotal = agent.tokenUsage?.total ?? (files ? files.filter((f) => f.inContext).reduce((sum, f) => sum + f.tokens, 0) : 0)

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 font-semibold">
            <Folder className="size-4 text-muted-foreground" />
            <span className="text-sm">{agent.id.includes('.') ? agent.id.split('.').slice(-1)[0] : agent.id}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
            <GitBranch className="size-3" />
            {t('agent_orchestrator.files.definition', 'definition')}
          </span>
          {files ? <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">{t('agent_orchestrator.files.fileCount', undefined, { count: files.length })}</span> : null}
          <div className="flex-1" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground" title={t('agent_orchestrator.files.tokenTotalHint', 'Total o200k_base token estimate the definition contributes to the agent context.')}>
            <Coins className="size-3" />
            ~{formatNumber(contextTotal, locale)} {t('agent_orchestrator.files.tokens', 'tokens')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-status-neutral-border bg-status-neutral-bg px-2.5 py-0.5 text-xs font-medium text-status-neutral-text">
            <Lock className="size-3" />
            {t('agent_orchestrator.files.readOnly', 'Read-only')}
          </span>
        </div>

        <DefinitionOverview agent={agent} />

        {state === 'loading' || state === 'idle' ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Spinner size="sm" />
            {t('agent_orchestrator.files.loading', 'Loading files…')}
          </div>
        ) : state === 'error' ? (
          <div className="p-6"><ErrorMessage label={t('agent_orchestrator.files.error', 'Could not load the agent files.')} /></div>
        ) : (
          <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[300px_1fr]">
            <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
              <div className="border-b border-border p-2.5">
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('agent_orchestrator.files.filter', 'Filter files…')} className="h-8" />
              </div>
              <div className="flex items-start gap-1.5 border-b border-border px-3 py-2 text-xs leading-snug text-muted-foreground">
                <Coins className="mt-0.5 size-3 shrink-0 text-brand-violet" />
                <span>{t('agent_orchestrator.files.tokenLegend', 'Numbers are the o200k_base token estimate each file adds to context; sample inputs are not counted.')}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-1.5">
                {visibleTree.length ? (
                  visibleTree.map((node) => (
                    <TreeNode key={node.path ?? node.name} node={node} depth={0} selectedPath={selectedPath} onSelect={setSelectedPath} locale={locale} />
                  ))
                ) : (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('agent_orchestrator.files.noMatches', 'No files match your filter.')}</p>
                )}
              </div>
            </div>
            {selectedFile ? <FileReader file={selectedFile} /> : (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">{t('agent_orchestrator.files.selectPrompt', 'Select a file to read it.')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default FilesTab
