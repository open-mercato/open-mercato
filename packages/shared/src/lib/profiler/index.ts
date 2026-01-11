import { parseBooleanToken } from '../boolean'

const ROUND_PRECISION = 1000
const NS_PER_MS = BigInt(1_000_000)
const BIGINT_ZERO = BigInt(0)

export type ProfilerExtra = Record<string, unknown>

export type ProfilerSnapshotNode = {
  label: string
  durationMs: number
  extra?: ProfilerExtra
  children?: ProfilerSnapshotNode[]
  type?: 'mark' | 'span' | 'record'
}

export type ProfilerSnapshot = {
  scope: string
  target?: string
  totalMs: number
  tree: ProfilerSnapshotNode[]
  meta?: ProfilerExtra
}

export type ProfilerSection = {
  end: (extra?: ProfilerExtra) => void
}

export type Profiler = {
  readonly enabled: boolean
  mark: (label: string, extra?: ProfilerExtra) => void
  section: (label: string, extra?: ProfilerExtra) => ProfilerSection
  measure: <T>(
    label: string,
    fn: () => Promise<T> | T,
    extra?: ((result: T) => ProfilerExtra | undefined) | ProfilerExtra
  ) => Promise<T>
  record: (label: string, durationMs: number, extra?: ProfilerExtra) => void
  child: (label: string, extra?: ProfilerExtra) => Profiler
  end: (extra?: ProfilerExtra) => void
}

type ProfilerNodeCommon = {
  label: string
  start: bigint
  durationNs: bigint
  extra?: ProfilerExtra
  type: 'mark' | 'span' | 'record'
}

type ProfilerSpanNode = ProfilerNodeCommon & {
  type: 'span'
  children: ProfilerInternalNode[]
  lastTimestamp: bigint
  closed: boolean
}

type ProfilerMarkNode = ProfilerNodeCommon & { type: 'mark' }
type ProfilerRecordNode = ProfilerNodeCommon & { type: 'record' }

type ProfilerInternalNode = ProfilerSpanNode | ProfilerMarkNode | ProfilerRecordNode

type ProfilerRootState = {
  scope: string
  target?: string
  label: string
  loggerLabel: string
  enabled: boolean
  startedAt: bigint
  lastTimestamp: bigint
  nodes: ProfilerInternalNode[]
  closed: boolean
  meta?: ProfilerExtra
}

type ProfilerImplOptions = {
  root: ProfilerRootState
  span?: ProfilerSpanNode
  parent?: ProfilerImpl
}

function now(): bigint {
  return process.hrtime.bigint()
}

function roundDuration(ns: bigint): number {
  if (ns <= BIGINT_ZERO) return 0
  const ms = Number(ns) / Number(NS_PER_MS)
  return Math.round(ms * ROUND_PRECISION) / ROUND_PRECISION
}

function mergeExtra(base: ProfilerExtra | undefined, extra: ProfilerExtra | undefined): ProfilerExtra | undefined {
  if (!base && !extra) return undefined
  if (!base) return extra ? { ...extra } : undefined
  if (!extra) return base ? { ...base } : undefined
  return { ...base, ...extra }
}

function serializeNode(node: ProfilerInternalNode): ProfilerSnapshotNode {
  const base: ProfilerSnapshotNode = {
    label: node.label,
    durationMs: roundDuration(node.durationNs),
  }
  if (node.extra && Object.keys(node.extra).length > 0) {
    base.extra = node.extra
  }
  base.type = node.type
  if (node.type === 'span' && node.children.length > 0) {
    base.children = node.children.map(serializeNode)
  }
  return base
}

class ProfilerImpl implements Profiler {
  private span?: ProfilerSpanNode
  private parent?: ProfilerImpl
  private root: ProfilerRootState
  private lastTimestamp: bigint
  private closed = false

  constructor(options: ProfilerImplOptions) {
    this.root = options.root
    this.span = options.span
    this.parent = options.parent
    this.lastTimestamp = options.span ? options.span.lastTimestamp : options.root.lastTimestamp
  }

  get enabled(): boolean {
    return this.root.enabled
  }

  mark(label: string, extra?: ProfilerExtra) {
    if (!this.enabled || this.closed) return
    const timestamp = now()
    const duration = timestamp - this.lastTimestamp
    const node: ProfilerMarkNode = {
      type: 'mark',
      label,
      start: timestamp,
      durationNs: duration >= BIGINT_ZERO ? duration : BIGINT_ZERO,
      extra: extra ? { ...extra } : undefined,
    }
    this.appendNode(node)
    this.updateTimestamps(timestamp)
  }

  section(label: string, extra?: ProfilerExtra): ProfilerSection {
    if (!this.enabled || this.closed) {
      return disabledSection
    }
    const child = this.child(label, extra)
    return {
      end: (childExtra?: ProfilerExtra) => child.end(childExtra),
    }
  }

  async measure<T>(
    label: string,
    fn: () => Promise<T> | T,
    extra?: ((result: T) => ProfilerExtra | undefined) | ProfilerExtra
  ): Promise<T> {
    if (!this.enabled || this.closed) {
      return Promise.resolve(fn())
    }
    const child = this.child(label)
    try {
      const result = await Promise.resolve(fn())
      const payload = typeof extra === 'function' ? extra(result) : extra
      child.end(payload)
      return result
    } catch (err) {
      child.end({ error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  record(label: string, durationMs: number, extra?: ProfilerExtra) {
    if (!this.enabled || this.closed) return
    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
    const durationNs = BigInt(Math.round(safeDurationMs * Number(NS_PER_MS)))
    const node: ProfilerRecordNode = {
      type: 'record',
      label,
      start: this.lastTimestamp,
      durationNs: durationNs >= BIGINT_ZERO ? durationNs : BIGINT_ZERO,
      extra: extra ? { ...extra } : undefined,
    }
    this.appendNode(node)
    this.updateTimestamps(this.lastTimestamp + node.durationNs)
  }

  child(label: string, extra?: ProfilerExtra): Profiler {
    if (!this.enabled || this.closed) return disabledProfiler
    const timestamp = now()
    const span: ProfilerSpanNode = {
      type: 'span',
      label,
      start: timestamp,
      durationNs: BIGINT_ZERO,
      extra: extra ? { ...extra } : undefined,
      children: [],
      lastTimestamp: timestamp,
      closed: false,
    }
    this.appendNode(span)
    this.updateTimestamps(timestamp)
    return new ProfilerImpl({ root: this.root, span, parent: this })
  }

  end(extra?: ProfilerExtra) {
    if (!this.enabled || this.closed) return
    const current = now()
    if (this.span) {
      this.closeSpan(current, extra)
    } else {
      this.closeRoot(current, extra)
    }
  }

  private appendNode(node: ProfilerInternalNode) {
    if (this.span) {
      this.span.children.push(node)
      this.span.lastTimestamp = node.start
    } else {
      this.root.nodes.push(node)
    }
  }

  private updateTimestamps(newTimestamp: bigint) {
    if (this.span) {
      this.span.lastTimestamp = newTimestamp
    } else {
      this.root.lastTimestamp = newTimestamp
    }
    this.lastTimestamp = newTimestamp
  }

  private closeSpan(closedAt: bigint, extra?: ProfilerExtra) {
    if (!this.span || this.span.closed) return
    const effectiveEnd = closedAt >= this.span.start ? closedAt : this.span.start
    this.span.durationNs = effectiveEnd - this.span.start
    this.span.extra = mergeExtra(this.span.extra, extra)
    this.span.closed = true
    this.closed = true
    this.updateTimestamps(effectiveEnd)
    if (this.parent) {
      this.parent.updateTimestamps(effectiveEnd)
    } else {
      this.root.lastTimestamp = effectiveEnd
    }
  }

  private closeRoot(closedAt: bigint, extra?: ProfilerExtra) {
    if (this.root.closed) return
    const endTime = closedAt >= this.root.startedAt ? closedAt : this.root.startedAt
    this.root.lastTimestamp = endTime
    this.root.meta = mergeExtra(this.root.meta, extra)
    this.root.closed = true
    this.closed = true
    const totalNs = endTime - this.root.startedAt
    const snapshot: ProfilerSnapshot = {
      scope: this.root.scope,
      target: this.root.target,
      totalMs: roundDuration(totalNs),
      tree: this.root.nodes.map(serializeNode),
    }
    if (this.root.meta && Object.keys(this.root.meta).length > 0) {
      snapshot.meta = this.root.meta
    }
    const serialized = JSON.stringify(snapshot, null, 2)
    try {
      console.info(this.root.loggerLabel, serialized)
    } catch {
      // ignore logging failures
    }
  }
}

const disabledSection: ProfilerSection = { end: () => {} }

const disabledProfiler: Profiler = {
  get enabled() {
    return false
  },
  mark: () => {},
  section: () => disabledSection,
  measure: async (_label, fn) => Promise.resolve(fn()),
  record: () => {},
  child: () => disabledProfiler,
  end: () => {},
}

export type CreateProfilerOptions = {
  scope: string
  target?: string
  label?: string
  enabled?: boolean
  loggerLabel?: string
  meta?: ProfilerExtra
}

export function createProfiler(options: CreateProfilerOptions): Profiler {
  if (options.enabled === false) return disabledProfiler
  const startedAt = now()
  const enabledFlag = options.enabled !== undefined ? options.enabled : true
  const root: ProfilerRootState = {
    scope: options.scope,
    target: options.target,
    label: options.label ?? options.scope,
    loggerLabel: options.loggerLabel ?? '[profile]',
    enabled: enabledFlag,
    startedAt,
    lastTimestamp: startedAt,
    nodes: [],
    closed: false,
    meta: options.meta ? { ...options.meta } : undefined,
  }
  return new ProfilerImpl({ root })
}

export function normalizeProfilerTokens(input: string | null | undefined): string[] {
  if (!input) return []
  return input
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
}

export function profilerMatches(target: string, tokens: string[]): boolean {
  if (!tokens.length) return false
  const lower = target.toLowerCase()
  return tokens.some((token) => {
    if (token === '*' || token === 'all' || parseBooleanToken(token) === true) return true
    if (token.endsWith('*')) {
      const prefix = token.slice(0, -1)
      return prefix.length === 0 ? true : lower.startsWith(prefix)
    }
    return token === lower
  })
}

const DEFAULT_ENV_KEYS = [
  'OM_PROFILE',
  'NEXT_PUBLIC_OM_PROFILE',
  'OM_CRUD_PROFILE',
  'NEXT_PUBLIC_OM_CRUD_PROFILE',
  'OM_QE_PROFILE',
  'NEXT_PUBLIC_OM_QE_PROFILE',
] as const

export function resolveProfilerTokens(envKeys: readonly string[] = DEFAULT_ENV_KEYS): string[] {
  const tokens: string[] = []
  envKeys.forEach((key) => {
    const raw = process.env[key]
    if (!raw) return
    const parsed = normalizeProfilerTokens(raw)
    if (parsed.length) tokens.push(...parsed)
  })
  return Array.from(new Set(tokens))
}

export function shouldEnableProfiler(
  target: string,
  options?: { tokens?: string[]; envKeys?: readonly string[] }
): boolean {
  const tokens = options?.tokens ?? resolveProfilerTokens(options?.envKeys)
  if (!tokens.length) return false
  return profilerMatches(target, tokens)
}

export const disabledProfilerInstance = disabledProfiler
