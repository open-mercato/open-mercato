"use client"

import * as React from 'react'
import { Copy } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatCostMicros, type LlmStepRow } from './llmStepRows'
import {
  MESSAGE_PAGE_SIZE,
  buildArtifactUrl,
  classifyArtifactResponse,
  contentMetadataSnapshot,
  contentRefForKind,
  listRequestParameters,
  parseLlmRequestPayload,
  parseLlmResponsePayload,
  type LlmContentFetchState,
  type LlmContentKind,
  type LlmMessagePart,
  type LlmStepContentRefs,
} from './llmStepContent'

const EMPTY_VALUE = '—'

type FetchStates = Record<LlmContentKind, LlmContentFetchState>

export type LlmStepPanelsProps = {
  runId: string
  row: LlmStepRow
  canViewContent: boolean | null
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>
}

function MonospaceBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">
      {text}
    </pre>
  )
}

function PartsView({ parts }: { parts: LlmMessagePart[] }) {
  if (parts.length === 0) return <span className="text-xs text-muted-foreground">{EMPTY_VALUE}</span>
  return (
    <div className="space-y-2">
      {parts.map((part, index) =>
        part.kind === 'text' ? (
          <MonospaceBlock key={index} text={part.text} />
        ) : (
          <JsonDisplay key={index} data={part.value} maxHeight="20rem" />
        ),
      )}
    </div>
  )
}

function copyJson(value: unknown, t: ReturnType<typeof useT>) {
  const text = JSON.stringify(value, null, 2)
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (!clipboard) {
    flash(t('agent_orchestrator.trace.copyFailed'), 'error')
    return
  }
  clipboard.writeText(text).then(
    () => flash(t('agent_orchestrator.trace.copied'), 'success'),
    () => flash(t('agent_orchestrator.trace.copyFailed'), 'error'),
  )
}

function ContentHashes({ refs, kind }: { refs: LlmStepContentRefs; kind: LlmContentKind }) {
  const t = useT()
  const ref = contentRefForKind(refs, kind)
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
      <dt className="text-muted-foreground">{t('agent_orchestrator.trace.contentSha256')}</dt>
      <dd className="break-all font-mono text-foreground">{ref.sha256 ?? EMPTY_VALUE}</dd>
      <dt className="text-muted-foreground">{t('agent_orchestrator.trace.contentBytes')}</dt>
      <dd className="font-mono tabular-nums text-foreground">{ref.bytes ?? EMPTY_VALUE}</dd>
    </dl>
  )
}

function MissingPermission({ refs, kind }: { refs: LlmStepContentRefs; kind: LlmContentKind }) {
  const t = useT()
  return (
    <div className="space-y-3" data-testid="llm-content-forbidden">
      <Alert status="information">
        <AlertTitle>{t('agent_orchestrator.trace.contentForbiddenTitle')}</AlertTitle>
        <AlertDescription>{t('agent_orchestrator.trace.contentForbidden')}</AlertDescription>
      </Alert>
      <ContentHashes refs={refs} kind={kind} />
    </div>
  )
}

function NotCaptured({ refs }: { refs: LlmStepContentRefs }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="llm-content-not-captured">
      <StatusBadge variant="neutral">{t('agent_orchestrator.trace.contentNotCaptured')}</StatusBadge>
      {refs.status ? (
        <span className="text-xs text-muted-foreground">
          {t(`agent_orchestrator.trace.contentStatus.${refs.status}`)}
        </span>
      ) : null}
    </div>
  )
}

function StateBadge({ variant, label, testId }: { variant: 'warning' | 'error'; label: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <StatusBadge variant={variant}>{label}</StatusBadge>
    </div>
  )
}

function TruncatedNotice() {
  const t = useT()
  return <StatusBadge variant="warning">{t('agent_orchestrator.trace.contentTruncated')}</StatusBadge>
}

function MessagesView({ messages }: { messages: ReturnType<typeof parseLlmRequestPayload>['messages'] }) {
  const t = useT()
  const [visible, setVisible] = React.useState(MESSAGE_PAGE_SIZE)
  if (messages.length === 0) return <span className="text-xs text-muted-foreground">{EMPTY_VALUE}</span>
  const shown = messages.slice(0, visible)
  return (
    <div className="space-y-3">
      {shown.map((message, index) => (
        <div key={index} className="space-y-1 rounded-md border border-border p-3" data-testid="llm-request-message">
          <StatusBadge variant="info">{message.role}</StatusBadge>
          <PartsView parts={message.parts} />
        </div>
      ))}
      {messages.length > visible ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setVisible(visible + MESSAGE_PAGE_SIZE)}>
          {t('agent_orchestrator.trace.showMoreMessages', undefined, { count: messages.length - visible })}
        </Button>
      ) : null}
    </div>
  )
}

function RequestView({ payload }: { payload: unknown }) {
  const t = useT()
  const request = React.useMemo(() => parseLlmRequestPayload(payload), [payload])
  const parameters = React.useMemo(() => listRequestParameters(request.params), [request.params])
  return (
    <div className="space-y-4" data-testid="llm-request-view">
      {request.truncated || request.reconstructed ? (
        <div className="flex flex-wrap gap-2">
          {request.truncated ? <TruncatedNotice /> : null}
          {request.reconstructed ? (
            <StatusBadge variant="warning">{t('agent_orchestrator.trace.fidelity.reconstructed')}</StatusBadge>
          ) : null}
        </div>
      ) : null}
      <section className="space-y-2">
        <SectionTitle>{t('agent_orchestrator.trace.systemPrompt')}</SectionTitle>
        {request.system !== null ? (
          <MonospaceBlock text={request.system} />
        ) : (
          <span className="text-xs text-muted-foreground">{EMPTY_VALUE}</span>
        )}
      </section>
      <section className="space-y-2">
        <SectionTitle>{t('agent_orchestrator.trace.messages')}</SectionTitle>
        <MessagesView messages={request.messages} />
      </section>
      <CollapsibleSection
        title={t('agent_orchestrator.trace.toolDefinitions')}
        count={request.tools.length}
        defaultCollapsed
      >
        <div className="space-y-2">
          {request.tools.map((tool, index) => (
            <CollapsibleSection key={`${tool.name}-${index}`} title={tool.name || EMPTY_VALUE} defaultCollapsed>
              {tool.description ? <p className="text-xs text-muted-foreground">{tool.description}</p> : null}
              <JsonDisplay data={tool.inputSchema} maxHeight="20rem" />
            </CollapsibleSection>
          ))}
        </div>
      </CollapsibleSection>
      <section className="space-y-2">
        <SectionTitle>{t('agent_orchestrator.trace.responseFormat')}</SectionTitle>
        {request.responseFormat !== null ? (
          <JsonDisplay data={request.responseFormat} maxHeight="20rem" />
        ) : (
          <span className="text-xs text-muted-foreground">{EMPTY_VALUE}</span>
        )}
      </section>
      <section className="space-y-2">
        <SectionTitle>{t('agent_orchestrator.trace.parameters')}</SectionTitle>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('agent_orchestrator.trace.parameterName')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.parameterValue')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parameters.map((parameter) => (
              <TableRow key={parameter.name}>
                <TableCell className="font-mono text-xs text-foreground">{parameter.name}</TableCell>
                <TableCell className="break-all font-mono text-xs">
                  {parameter.value ?? (
                    <span className="font-sans text-muted-foreground">
                      {t('agent_orchestrator.trace.providerDefault')}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}

function ResponseView({ payload, row }: { payload: unknown; row: LlmStepRow }) {
  const t = useT()
  const locale = useLocale()
  const response = React.useMemo(() => parseLlmResponsePayload(payload), [payload])
  const finishReason = response.finishReason ?? (row.finishReasons.length > 0 ? row.finishReasons.join(', ') : null)
  return (
    <div className="space-y-4" data-testid="llm-response-view">
      {response.truncated ? <TruncatedNotice /> : null}
      <section className="space-y-2">
        <SectionTitle>{t('agent_orchestrator.trace.contentParts')}</SectionTitle>
        <PartsView parts={response.parts} />
      </section>
      {response.hasObject ? (
        <section className="space-y-2">
          <SectionTitle>{t('agent_orchestrator.trace.structuredObject')}</SectionTitle>
          <JsonDisplay data={response.object} maxHeight="20rem" />
        </section>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t('agent_orchestrator.trace.columns.finishReason')}</dt>
        <dd className="font-mono text-foreground">{finishReason ?? EMPTY_VALUE}</dd>
        <dt className="text-muted-foreground">{t('agent_orchestrator.trace.usage')}</dt>
        <dd className="font-mono text-foreground">
          {response.usage.length > 0
            ? response.usage.map((entry) => `${entry.name}=${entry.value}`).join(', ')
            : EMPTY_VALUE}
        </dd>
        <dt className="text-muted-foreground">{t('agent_orchestrator.trace.costPerStep')}</dt>
        <dd className="font-mono tabular-nums text-foreground">
          {row.costMicros !== null ? formatCostMicros(row.costMicros, row.currency, locale) : EMPTY_VALUE}
        </dd>
      </dl>
    </div>
  )
}

function ContentPanel({
  kind,
  row,
  state,
  canViewContent,
}: {
  kind: LlmContentKind
  row: LlmStepRow
  state: LlmContentFetchState
  canViewContent: boolean | null
}) {
  const t = useT()
  const refs = row.content
  const ref = contentRefForKind(refs, kind)
  const copyValue = state.status === 'ok' ? state.payload : contentMetadataSnapshot(refs, kind)
  const body = (() => {
    if (!ref.key || refs.status === 'disabled') return <NotCaptured refs={refs} />
    if (canViewContent === false || state.status === 'forbidden') return <MissingPermission refs={refs} kind={kind} />
    if (state.status === 'idle' || state.status === 'loading') {
      return <LoadingMessage label={t('agent_orchestrator.trace.contentLoading')} />
    }
    if (state.status === 'expired') {
      return (
        <StateBadge
          variant="warning"
          label={t('agent_orchestrator.trace.contentExpired')}
          testId="llm-content-expired"
        />
      )
    }
    if (state.status === 'unavailable') {
      return (
        <StateBadge
          variant="error"
          label={t('agent_orchestrator.trace.contentStorageUnavailable')}
          testId="llm-content-unavailable"
        />
      )
    }
    if (state.status === 'error') return <ErrorMessage label={t('agent_orchestrator.trace.contentError')} />
    return kind === 'llm_request' ? (
      <RequestView payload={state.payload} />
    ) : (
      <ResponseView payload={state.payload} row={row} />
    )
  })()
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('agent_orchestrator.trace.copyAsJson')}
          title={t('agent_orchestrator.trace.copyAsJson')}
          onClick={() => copyJson(copyValue, t)}
        >
          <Copy />
        </IconButton>
      </div>
      {body}
    </div>
  )
}

function shouldFetch(row: LlmStepRow, kind: LlmContentKind, canViewContent: boolean | null): string | null {
  const key = contentRefForKind(row.content, kind).key
  if (!key || row.content.status === 'disabled' || canViewContent === false) return null
  return key
}

export function LlmStepPanels({ runId, row, canViewContent }: LlmStepPanelsProps) {
  const t = useT()
  const [activeTab, setActiveTab] = React.useState<LlmContentKind>('llm_request')
  const [states, setStates] = React.useState<FetchStates>({
    llm_request: { status: 'idle' },
    llm_response: { status: 'idle' },
  })
  const requestedRef = React.useRef(new Set<LlmContentKind>())
  const settledRef = React.useRef(new Set<LlmContentKind>())
  const fetchKeys: Record<LlmContentKind, string | null> = {
    llm_request: shouldFetch(row, 'llm_request', canViewContent),
    llm_response: shouldFetch(row, 'llm_response', canViewContent),
  }
  const activeKey = fetchKeys[activeTab]

  React.useEffect(() => {
    const kind = activeTab
    const requested = requestedRef.current
    const settled = settledRef.current
    if (!activeKey || requested.has(kind)) return
    requested.add(kind)
    let cancelled = false
    const settle = (next: LlmContentFetchState) => {
      if (cancelled) return
      settled.add(kind)
      setStates((previous) => ({ ...previous, [kind]: next }))
    }
    setStates((previous) => ({ ...previous, [kind]: { status: 'loading' } }))
    apiCall<{ payload?: unknown }>(buildArtifactUrl(runId, kind, activeKey), undefined, { fallback: null }).then(
      (call) => settle(classifyArtifactResponse(call.ok, call.status, call.result?.payload ?? null)),
      () => settle({ status: 'error' }),
    )
    return () => {
      cancelled = true
      if (!settled.has(kind)) requested.delete(kind)
    }
  }, [activeTab, activeKey, runId])

  return (
    <div className="space-y-2" data-testid="llm-step-panels">
      <Tabs
        variant="underline"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value === 'llm_response' ? 'llm_response' : 'llm_request')}
      >
        <TabsList aria-label={t('agent_orchestrator.trace.contentTabs')}>
          <TabsTrigger value="llm_request">{t('agent_orchestrator.trace.request')}</TabsTrigger>
          <TabsTrigger value="llm_response">{t('agent_orchestrator.trace.response')}</TabsTrigger>
        </TabsList>
        <TabsContent value="llm_request">
          <ContentPanel kind="llm_request" row={row} state={states.llm_request} canViewContent={canViewContent} />
        </TabsContent>
        <TabsContent value="llm_response">
          <ContentPanel kind="llm_response" row={row} state={states.llm_response} canViewContent={canViewContent} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default LlmStepPanels
