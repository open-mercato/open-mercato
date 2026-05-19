/**
 * Visible AI chat agent task plan — server-side SSE injector.
 *
 * Spec: `.ai/specs/2026-05-13-ai-chat-visible-task-plan.md`.
 *
 * Wraps a streaming `Response` produced by `streamText().toUIMessageStreamResponse()`
 * (or the equivalent `ToolLoopAgent.stream(...).toUIMessageStreamResponse()`)
 * and interleaves additive `data-agent-task-plan` / `data-agent-task-update`
 * SSE chunks alongside the AI SDK tool lifecycle chunks. The original chunks
 * are passed through unchanged so existing clients that ignore unknown chunk
 * types continue to work.
 *
 * The injector derives task labels and states from the SDK tool lifecycle:
 *   - `tool-input-start`         → create/update task with state `running`
 *   - `tool-input-available`     → keep task `running` (label may be refined)
 *   - `tool-output-available`    → mark task `done`
 *   - `tool-output-error`        → mark task `failed`
 *   - `tool-input-error`         → mark task `failed`
 *
 * Agent-authored labels flow through the reserved non-mutation
 * `meta.update_task_plan` tool. Its input is sanitized before the plan reaches
 * the client; the raw meta-tool call is still passed through for older clients
 * but the visible plan uses only the safe labels.
 */

import {
  TASK_PLAN_LABEL_MAX_CHARS,
  isTaskPlanToolName,
  normalizeTaskPlanToolName,
  sanitizeAgentTaskPlanInput,
} from './task-plan-labels'

const SSE_ENCODER = new TextEncoder()
const SSE_DECODER = new TextDecoder()

/**
 * Mirrors the client-side `AiAgentTaskSnapshot` so server and client agree on
 * the wire format. Kept locally in this module to avoid pulling a UI package
 * dependency into the runtime — the shape is small and only ever serialized
 * to JSON for the SSE chunks below.
 */
export interface ServerTaskSnapshot {
  id: string
  label: string
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail?: string
  source: 'runtime' | 'agent'
  toolCallId?: string
}

const TERMINAL_STATES: ReadonlySet<ServerTaskSnapshot['state']> = new Set([
  'done',
  'failed',
  'skipped',
])

const TASK_LABEL_MAX_CHARS = TASK_PLAN_LABEL_MAX_CHARS

/**
 * Convert a raw model-sanitized tool name (e.g. `customers__list_people`) to a
 * compact operator-facing label (e.g. `Customers list people`). The trailing
 * segment is title-cased so the plan reads like a checklist instead of a code
 * trace.
 */
export function deriveTaskLabel(toolName: string | undefined): string {
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return 'Tool call'
  }
  const display = toolName.replace(/__/g, '.')
  const segments = display.split('.')
  const lastSegment = segments[segments.length - 1] ?? display
  const humanized = lastSegment.replace(/_/g, ' ').trim()
  if (humanized.length === 0) return display.slice(0, TASK_LABEL_MAX_CHARS)
  const titled = humanized.charAt(0).toUpperCase() + humanized.slice(1)
  if (segments.length <= 1) {
    return titled.slice(0, TASK_LABEL_MAX_CHARS)
  }
  const moduleSegment = segments[0]
  const moduleLabel = moduleSegment.charAt(0).toUpperCase() + moduleSegment.slice(1).replace(/_/g, ' ')
  const combined = `${moduleLabel} · ${titled}`
  return combined.slice(0, TASK_LABEL_MAX_CHARS)
}

type AccumulatorEntry = {
  snapshot: ServerTaskSnapshot
  emitted: boolean
}

type ToolChunk = {
  type?: unknown
  toolCallId?: unknown
  toolName?: unknown
  input?: unknown
}

/**
 * Encapsulates the per-turn task-plan state. Exposed for unit tests so the
 * derivation logic can be exercised without standing up a full SSE pipeline.
 */
export class TaskPlanAccumulator {
  private readonly tasks = new Map<string, AccumulatorEntry>()
  private readonly toolCallToTaskId = new Map<string, string>()
  private readonly taskToolNames = new Map<string, string>()
  private readonly internalToolCallIds = new Set<string>()
  private snapshotEmitted = false
  private hasAgentAuthoredPlan = false

  constructor(public readonly planId: string) {}

  private upsert(
    id: string,
    patch: Partial<ServerTaskSnapshot> & { label?: string; toolCallId?: string },
  ): ServerTaskSnapshot {
    const existing = this.tasks.get(id)
    if (!existing) {
      const created: ServerTaskSnapshot = {
        id,
        label: patch.label ?? 'Tool call',
        state: patch.state ?? 'running',
        source: patch.source ?? 'runtime',
        detail: patch.detail,
        toolCallId: patch.toolCallId,
      }
      this.tasks.set(id, { snapshot: created, emitted: false })
      return created
    }
    const current = existing.snapshot
    const nextState = TERMINAL_STATES.has(current.state) ? current.state : patch.state ?? current.state
    const merged: ServerTaskSnapshot = {
      id: current.id,
      label: patch.label ?? current.label,
      state: nextState,
      source: patch.source ?? current.source,
      detail: patch.detail ?? current.detail,
      toolCallId: patch.toolCallId ?? current.toolCallId,
    }
    this.tasks.set(id, { snapshot: merged, emitted: existing.emitted })
    return merged
  }

  private makeUniqueTaskId(baseId: string): string {
    let candidate = baseId
    let suffix = 2
    while (this.tasks.has(candidate)) {
      candidate = `${baseId}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  private emitFullSnapshot(): string[] {
    if (this.tasks.size === 0) return []
    this.snapshotEmitted = true
    const initialTasks = Array.from(this.tasks.values()).map((e) => e.snapshot)
    for (const e of this.tasks.values()) e.emitted = true
    return [
      formatSseEvent({
        type: 'data-agent-task-plan',
        planId: this.planId,
        tasks: initialTasks,
      }),
    ]
  }

  private handleAgentAuthoredPlan(input: unknown): string[] {
    const plan = sanitizeAgentTaskPlanInput(input)
    if (plan.tasks.length === 0) return []

    this.tasks.clear()
    this.toolCallToTaskId.clear()
    this.taskToolNames.clear()
    this.snapshotEmitted = false
    this.hasAgentAuthoredPlan = true

    plan.tasks.forEach((task, index) => {
      const id = this.makeUniqueTaskId(task.id ?? `agent-plan-${index + 1}`)
      const snapshot: ServerTaskSnapshot = {
        id,
        label: task.label,
        state: 'pending',
        source: 'agent',
        detail: task.detail,
      }
      this.tasks.set(id, { snapshot, emitted: false })
      if (task.toolName) {
        this.taskToolNames.set(id, task.toolName)
      }
    })

    return this.emitFullSnapshot()
  }

  private resolveTaskIdForToolCall(toolCallId: string, toolName: string | undefined): string {
    const existing = this.toolCallToTaskId.get(toolCallId)
    if (existing) return existing
    const plannedTaskId = this.findPlannedTaskId(toolName)
    if (plannedTaskId) {
      this.toolCallToTaskId.set(toolCallId, plannedTaskId)
      return plannedTaskId
    }
    this.toolCallToTaskId.set(toolCallId, toolCallId)
    return toolCallId
  }

  private findPlannedTaskId(toolName: string | undefined): string | null {
    if (!this.hasAgentAuthoredPlan) return null
    const entries = Array.from(this.tasks.entries())
    const isAvailable = (entry: AccumulatorEntry) => !TERMINAL_STATES.has(entry.snapshot.state)
    if (toolName) {
      const exactPending = entries.find(([id, entry]) => {
        return entry.snapshot.state === 'pending' && this.taskToolNames.get(id) === toolName
      })
      if (exactPending) return exactPending[0]
      const exactAvailable = entries.find(([id, entry]) => {
        return isAvailable(entry) && this.taskToolNames.get(id) === toolName
      })
      if (exactAvailable) return exactAvailable[0]
    }
    const genericPending = entries.find(([id, entry]) => {
      return entry.snapshot.state === 'pending' && !this.taskToolNames.has(id)
    })
    if (genericPending) return genericPending[0]
    const genericAvailable = entries.find(([id, entry]) => {
      return isAvailable(entry) && !this.taskToolNames.has(id)
    })
    return genericAvailable?.[0] ?? null
  }

  private existingSnapshot(taskId: string): ServerTaskSnapshot | undefined {
    return this.tasks.get(taskId)?.snapshot
  }

  /**
   * Apply a tool lifecycle chunk. Returns the SSE event lines (already
   * `data: ...\n\n`-formatted) that should be injected ahead of forwarding
   * the original chunk to the client.
   */
  handleToolChunk(chunk: ToolChunk): string[] {
    if (!chunk || typeof chunk.type !== 'string') return []
    const toolCallId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : null
    const toolName = normalizeTaskPlanToolName(chunk.toolName)
    if (isTaskPlanToolName(toolName)) {
      if (toolCallId) this.internalToolCallIds.add(toolCallId)
      if (chunk.type === 'tool-input-available') {
        return this.handleAgentAuthoredPlan(chunk.input)
      }
      return []
    }
    if (!toolCallId) return []
    if (this.internalToolCallIds.has(toolCallId)) return []
    const taskId = this.resolveTaskIdForToolCall(toolCallId, toolName)
    const existing = this.existingSnapshot(taskId)
    const source = existing?.source ?? 'runtime'
    const runtimeLabel = deriveTaskLabel(toolName)
    const runtimeDetail = toolName
    let nextSnapshot: ServerTaskSnapshot | null = null
    switch (chunk.type) {
      case 'tool-input-start':
        nextSnapshot = this.upsert(taskId, {
          label: source === 'agent' ? existing?.label : runtimeLabel,
          state: 'running',
          source,
          toolCallId,
          detail: source === 'agent' ? existing?.detail : runtimeDetail,
        })
        break
      case 'tool-input-available':
        // Runtime-derived tasks can refine the label when the SDK includes a
        // richer toolName on input-available. Agent-authored tasks keep the
        // safe label the model supplied through `meta.update_task_plan`.
        nextSnapshot = this.upsert(taskId, {
          label: source === 'agent' ? existing?.label : runtimeLabel,
          state: 'running',
          source,
          toolCallId,
          detail: source === 'agent' ? existing?.detail : runtimeDetail,
        })
        break
      case 'tool-output-available':
        nextSnapshot = this.upsert(taskId, {
          state: 'done',
          source,
          toolCallId,
        })
        break
      case 'tool-output-error':
      case 'tool-input-error':
        nextSnapshot = this.upsert(taskId, {
          state: 'failed',
          source,
          toolCallId,
        })
        break
      default:
        return []
    }
    if (!nextSnapshot) return []
    return this.emitForSnapshot(taskId, nextSnapshot)
  }

  private emitForSnapshot(id: string, snapshot: ServerTaskSnapshot): string[] {
    const entry = this.tasks.get(id)
    if (!entry) return []
    const lines: string[] = []
    if (!this.snapshotEmitted) {
      return this.emitFullSnapshot()
    }
    if (!entry.emitted) {
      // First time we surface this task: it must be part of the next snapshot
      // refresh, but to keep the protocol minimal we emit a single
      // `data-agent-task-update` carrying the new task — clients merge by id.
      lines.push(
        formatSseEvent({
          type: 'data-agent-task-update',
          planId: this.planId,
          task: snapshot,
        }),
      )
      entry.emitted = true
      return lines
    }
    lines.push(
      formatSseEvent({
        type: 'data-agent-task-update',
        planId: this.planId,
        task: snapshot,
      }),
    )
    return lines
  }
}

export function formatSseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/**
 * Wrap a streaming `Response` and interleave `data-agent-task-plan` /
 * `data-agent-task-update` SSE chunks. The wrapper does not consume the
 * stream — it pipes bytes through and only parses event boundaries to know
 * when to inject extra chunks.
 */
export function injectTaskPlanIntoStream(
  baseResponse: Response,
  planId: string,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const accumulator = new TaskPlanAccumulator(planId)

  async function pump(): Promise<void> {
    if (!baseResponse.body) {
      await writer.close()
      return
    }
    const reader = baseResponse.body.getReader()
    let textBuffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        textBuffer += SSE_DECODER.decode(value, { stream: true })
        textBuffer = await flushBuffer(textBuffer, accumulator, writer)
      }
      const tail = SSE_DECODER.decode()
      if (tail) {
        textBuffer += tail
      }
      if (textBuffer.length > 0) {
        // Best-effort flush of any trailing bytes (the AI SDK always
        // terminates events with `\n\n` so this path is rare).
        await writer.write(SSE_ENCODER.encode(textBuffer))
      }
    } catch {
      // Surface upstream aborts to the downstream consumer by closing the
      // writer — propagating the error would corrupt the SSE stream.
    } finally {
      reader.releaseLock()
      await writer.close().catch(() => undefined)
    }
  }

  void pump()
  return new Response(readable, {
    status: baseResponse.status,
    headers: baseResponse.headers,
  })
}

async function flushBuffer(
  buffer: string,
  accumulator: TaskPlanAccumulator,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<string> {
  let rest = buffer
  for (;;) {
    const boundary = rest.indexOf('\n\n')
    if (boundary === -1) break
    const eventBlock = rest.slice(0, boundary + 2)
    rest = rest.slice(boundary + 2)
    const injected = inspectEventBlock(eventBlock, accumulator)
    for (const line of injected.before) {
      await writer.write(SSE_ENCODER.encode(line))
    }
    await writer.write(SSE_ENCODER.encode(eventBlock))
    for (const line of injected.after) {
      await writer.write(SSE_ENCODER.encode(line))
    }
  }
  return rest
}

interface InjectedLines {
  before: string[]
  after: string[]
}

function inspectEventBlock(
  eventBlock: string,
  accumulator: TaskPlanAccumulator,
): InjectedLines {
  const dataPayload = extractDataPayload(eventBlock)
  if (!dataPayload || dataPayload === '[DONE]') {
    return { before: [], after: [] }
  }
  let parsed: ToolChunk | null = null
  try {
    parsed = JSON.parse(dataPayload)
  } catch {
    return { before: [], after: [] }
  }
  if (!parsed || typeof parsed.type !== 'string') {
    return { before: [], after: [] }
  }
  const type = parsed.type
  const injected = accumulator.handleToolChunk(parsed)
  if (injected.length === 0) {
    return { before: [], after: [] }
  }
  // Tool-input-start gets the plan event BEFORE the original (so the row
  // appears at the same time as the tool starts). Output / error events
  // get the plan event AFTER so the row updates only once the tool result
  // is visible in the existing tool-call detail row.
  if (type === 'tool-input-start' || type === 'tool-input-available') {
    return { before: injected, after: [] }
  }
  return { before: [], after: injected }
}

function extractDataPayload(eventBlock: string): string | null {
  const lines = eventBlock.split('\n')
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6))
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5))
    }
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}
