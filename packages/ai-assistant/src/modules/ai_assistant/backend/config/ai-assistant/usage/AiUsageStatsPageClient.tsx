'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, ChevronRight, Loader2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type DailyRow = {
  id: string
  tenantId: string
  organizationId: string | null
  day: string
  agentId: string
  modelId: string
  providerId: string
  inputTokens: string
  outputTokens: string
  cachedInputTokens: string
  reasoningTokens: string
  stepCount: string
  turnCount: string
  sessionCount: string
  createdAt: string
  updatedAt: string
}

type DailyResponse = {
  rows: DailyRow[]
  total: number
}

type SessionSummary = {
  sessionId: string
  agentId: string
  moduleId: string
  userId: string
  startedAt: string
  lastEventAt: string
  stepCount: number
  turnCount: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

type SessionsResponse = {
  sessions: SessionSummary[]
  total: number
  limit: number
  offset: number
}

type StepEvent = {
  id: string
  tenantId: string
  organizationId: string | null
  userId: string
  agentId: string
  moduleId: string
  sessionId: string
  turnId: string
  stepIndex: number
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number | null
  reasoningTokens: number | null
  finishReason: string | null
  loopAbortReason: string | null
  createdAt: string
  updatedAt: string
}

type SessionDetailResponse = {
  events: StepEvent[]
  total: number
  sessionId: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

async function fetchDailyRollup(from: string, to: string): Promise<DailyResponse> {
  const params = new URLSearchParams({ from, to })
  const { result, status } = await apiCallOrThrow<DailyResponse>(
    `/api/ai_assistant/usage/daily?${params}`,
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load daily token usage' },
  )
  if (!result) throw new Error(`Failed to load daily usage (${status})`)
  return result
}

async function fetchSessions(from: string, to: string, offset: number): Promise<SessionsResponse> {
  const params = new URLSearchParams({ from, to, limit: '50', offset: String(offset) })
  const { result, status } = await apiCallOrThrow<SessionsResponse>(
    `/api/ai_assistant/usage/sessions?${params}`,
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load session list' },
  )
  if (!result) throw new Error(`Failed to load sessions (${status})`)
  return result
}

async function fetchSessionDetail(sessionId: string): Promise<SessionDetailResponse> {
  const { result, status } = await apiCallOrThrow<SessionDetailResponse>(
    `/api/ai_assistant/usage/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load session detail' },
  )
  if (!result) throw new Error(`Failed to load session detail (${status})`)
  return result
}

function sumBigintRows(rows: DailyRow[], field: keyof DailyRow): number {
  return rows.reduce((acc, row) => acc + parseInt(String(row[field] ?? '0'), 10), 0)
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

export function AiUsageStatsPageClient() {
  const t = useT()

  const defaultFrom = daysAgoIso(30)
  const defaultTo = todayIso()

  const [from, setFrom] = React.useState(defaultFrom)
  const [to, setTo] = React.useState(defaultTo)
  const [appliedFrom, setAppliedFrom] = React.useState(defaultFrom)
  const [appliedTo, setAppliedTo] = React.useState(defaultTo)
  const [sessionsOffset, setSessionsOffset] = React.useState(0)
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null)

  const dailyQuery = useQuery({
    queryKey: ['ai-usage-daily', appliedFrom, appliedTo],
    queryFn: () => fetchDailyRollup(appliedFrom, appliedTo),
  })

  const sessionsQuery = useQuery({
    queryKey: ['ai-usage-sessions', appliedFrom, appliedTo, sessionsOffset],
    queryFn: () => fetchSessions(appliedFrom, appliedTo, sessionsOffset),
  })

  const sessionDetailQuery = useQuery({
    queryKey: ['ai-usage-session-detail', selectedSessionId],
    queryFn: () => fetchSessionDetail(selectedSessionId!),
    enabled: selectedSessionId !== null,
  })

  function applyFilter() {
    setSessionsOffset(0)
    setAppliedFrom(from)
    setAppliedTo(to)
  }

  const dailyRows = dailyQuery.data?.rows ?? []
  const totalInputTokens = sumBigintRows(dailyRows, 'inputTokens')
  const totalOutputTokens = sumBigintRows(dailyRows, 'outputTokens')
  const totalSteps = sumBigintRows(dailyRows, 'stepCount')
  const totalSessions = sumBigintRows(dailyRows, 'sessionCount')

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <BarChart2 className="text-muted-foreground" size={20} />
        <h2 className="text-lg font-semibold">
          {t('ai_assistant.usage.title', 'Token Usage Statistics')}
        </h2>
      </div>

      {/* Date range filter */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="usage-from">
            {t('ai_assistant.usage.from', 'From')}
          </Label>
          <Input
            id="usage-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="usage-to">
            {t('ai_assistant.usage.to', 'To')}
          </Label>
          <Input
            id="usage-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
        </div>
        <Button variant="secondary" onClick={applyFilter}>
          {t('ai_assistant.usage.apply', 'Apply')}
        </Button>
      </div>

      {/* Summary tiles */}
      {dailyQuery.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={14} className="animate-spin" />
          {t('ai_assistant.usage.loading', 'Loading usage data...')}
        </div>
      )}
      {dailyQuery.isError && (
        <p className="text-status-error-text text-sm">
          {t('ai_assistant.usage.error', 'Failed to load usage data.')}
        </p>
      )}
      {dailyQuery.isSuccess && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: t('ai_assistant.usage.inputTokens', 'Input tokens'), value: formatNumber(totalInputTokens) },
            { label: t('ai_assistant.usage.outputTokens', 'Output tokens'), value: formatNumber(totalOutputTokens) },
            { label: t('ai_assistant.usage.steps', 'Steps'), value: formatNumber(totalSteps) },
            { label: t('ai_assistant.usage.sessions', 'Sessions'), value: formatNumber(totalSessions) },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border border-border p-4 space-y-1">
              <p className="text-muted-foreground text-xs">{tile.label}</p>
              <p className="font-semibold text-xl">{tile.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Daily breakdown table */}
      {dailyQuery.isSuccess && dailyRows.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t('ai_assistant.usage.dailyBreakdown', 'Daily breakdown')}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {t('ai_assistant.usage.col.day', 'Day')}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {t('ai_assistant.usage.col.agent', 'Agent')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    {t('ai_assistant.usage.col.inputTokens', 'Input')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    {t('ai_assistant.usage.col.outputTokens', 'Output')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    {t('ai_assistant.usage.col.sessions', 'Sessions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 tabular-nums">{row.day}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.agentId}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(parseInt(row.inputTokens, 10))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(parseInt(row.outputTokens, 10))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.sessionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sessions list */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t('ai_assistant.usage.sessionsList', 'Sessions')}
        </h3>
        {sessionsQuery.isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" />
            {t('ai_assistant.usage.loadingSessions', 'Loading sessions...')}
          </div>
        )}
        {sessionsQuery.isError && (
          <p className="text-status-error-text text-sm">
            {t('ai_assistant.usage.errorSessions', 'Failed to load sessions.')}
          </p>
        )}
        {sessionsQuery.isSuccess && (sessionsQuery.data?.sessions ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">
            {t('ai_assistant.usage.noSessions', 'No sessions found for the selected period.')}
          </p>
        )}
        {sessionsQuery.isSuccess && (sessionsQuery.data?.sessions ?? []).length > 0 && (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t('ai_assistant.usage.col.session', 'Session')}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t('ai_assistant.usage.col.agent', 'Agent')}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t('ai_assistant.usage.col.startedAt', 'Started')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                      {t('ai_assistant.usage.col.inputTokens', 'Input')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                      {t('ai_assistant.usage.col.outputTokens', 'Output')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                      {t('ai_assistant.usage.col.steps', 'Steps')}
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {(sessionsQuery.data?.sessions ?? []).map((session) => (
                    <tr
                      key={session.sessionId}
                      className="border-b border-border last:border-b-0 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setSelectedSessionId(session.sessionId)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{shortId(session.sessionId)}…</td>
                      <td className="px-3 py-2 font-mono text-xs">{session.agentId}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{formatDate(session.startedAt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(session.inputTokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(session.outputTokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{session.stepCount}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={sessionsOffset === 0}
                onClick={() => setSessionsOffset(Math.max(0, sessionsOffset - 50))}
              >
                {t('ai_assistant.usage.prev', 'Previous')}
              </Button>
              <span className="text-muted-foreground text-sm">
                {sessionsOffset + 1}–{sessionsOffset + (sessionsQuery.data?.sessions.length ?? 0)}
                {sessionsQuery.data?.total !== undefined ? ` / ${sessionsQuery.data.total}` : ''}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  (sessionsQuery.data?.sessions.length ?? 0) < 50 ||
                  sessionsOffset + 50 >= (sessionsQuery.data?.total ?? 0)
                }
                onClick={() => setSessionsOffset(sessionsOffset + 50)}
              >
                {t('ai_assistant.usage.next', 'Next')}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Session drill-down dialog */}
      <Dialog
        open={selectedSessionId !== null}
        onOpenChange={(open) => { if (!open) setSelectedSessionId(null) }}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('ai_assistant.usage.sessionDetail', 'Session detail')}
              {selectedSessionId && (
                <span className="ml-2 font-mono text-sm text-muted-foreground">
                  {shortId(selectedSessionId)}…
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {sessionDetailQuery.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 size={14} className="animate-spin" />
                {t('ai_assistant.usage.loadingDetail', 'Loading session events...')}
              </div>
            )}
            {sessionDetailQuery.isError && (
              <p className="text-status-error-text text-sm">
                {t('ai_assistant.usage.errorDetail', 'Failed to load session events.')}
              </p>
            )}
            {sessionDetailQuery.isSuccess && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        {t('ai_assistant.usage.col.step', 'Step')}
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        {t('ai_assistant.usage.col.model', 'Model')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        {t('ai_assistant.usage.col.inputTokens', 'Input')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        {t('ai_assistant.usage.col.outputTokens', 'Output')}
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        {t('ai_assistant.usage.col.finishReason', 'Finish')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sessionDetailQuery.data?.events ?? []).map((event) => (
                      <tr key={event.id} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 tabular-nums">{event.stepIndex}</td>
                        <td className="px-3 py-2 font-mono text-xs">{event.modelId}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(event.inputTokens)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(event.outputTokens)}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{event.finishReason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
