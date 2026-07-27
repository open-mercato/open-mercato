import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * Per-run sandbox lifecycle for the OpenCode file plane (#12).
 *
 * When a file-enabled OpenCode agent runs, it needs a writable directory the
 * agent (in the OpenCode container) and the OM runtime (this process) both see
 * over a shared-volume mount at `OM_OPENCODE_WORKSPACE_ROOT`. This manager:
 *
 *  - gates concurrent tool-enabled runs behind an in-process semaphore sized by
 *    `OM_OPENCODE_POOL_SIZE` (default 1 → serialized), the Phase-0 "exclusive
 *    lease" model over the single shared `opencode serve` container;
 *  - creates `<root>/<sessionToken>/{in,out}` on acquire;
 *  - WIPES that subdir on release (before the slot is reused) so no bytes survive
 *    into a later lease.
 *
 * Isolation between concurrent runs is by unique per-`sessionToken` subdir (an
 * agent is never told another run's token) plus the wipe; the semaphore adds
 * capacity control + defense-in-depth serialization. Register as a DI SINGLETON
 * so the semaphore is process-wide. Cross-PROCESS serialization on the shared
 * container (a distributed lock) is deferred to the Phase-4 hardening.
 */

const DEFAULT_WORKSPACE_ROOT = '/home/opencode/work'
const DEFAULT_POOL_SIZE = 1
const DEFAULT_LEASE_TIMEOUT_MS = 5 * 60_000

/**
 * The OM process (this code) and the OpenCode container share the sandbox over a
 * volume, but the mount path can DIFFER between them: in full-docker both mount
 * it at the same path, but with the app on the host and OpenCode in a container
 * the host bind-mount path (where OM does fs ops) is not the container path (what
 * the agent must be told). `OM_OPENCODE_WORKSPACE_ROOT` is the OM/host-side root;
 * `OM_OPENCODE_WORKSPACE_ROOT_CONTAINER` is the container-side root (defaults to
 * the host root, i.e. the equal-path full-docker case). The frontmatter permission
 * glob (defineFileAgent) uses the CONTAINER root.
 */
function resolveWorkspaceRoot(): string {
  const raw = process.env.OM_OPENCODE_WORKSPACE_ROOT
  return raw && raw.trim().length > 0 ? raw.trim() : DEFAULT_WORKSPACE_ROOT
}

function resolveContainerRoot(): string {
  const raw = process.env.OM_OPENCODE_WORKSPACE_ROOT_CONTAINER
  return raw && raw.trim().length > 0 ? raw.trim() : resolveWorkspaceRoot()
}

function resolvePoolSize(): number {
  const raw = Number.parseInt(process.env.OM_OPENCODE_POOL_SIZE ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POOL_SIZE
}

function resolveLeaseTimeoutMs(): number {
  const raw = Number.parseInt(process.env.OM_OPENCODE_LEASE_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEASE_TIMEOUT_MS
}

/** A leased sandbox. Call `release()` exactly once (idempotent) in the runner `finally`. */
export type AgentWorkspaceLease = {
  /** HOST `<root>/<sessionToken>` — the run's private sandbox dir (OM fs ops). */
  readonly root: string
  /** HOST `in/` dir where the stager writes attachment inputs. */
  readonly inDir: string
  /** HOST `out/` dir the collector scans for agent-authored artifacts. */
  readonly outDir: string
  /** CONTAINER-side `in/` path told to the agent (equals `inDir` in full-docker). */
  readonly containerInDir: string
  /** CONTAINER-side `out/` path told to the agent (equals `outDir` in full-docker). */
  readonly containerOutDir: string
  /** Wipe the sandbox subdir and free the lease slot. Idempotent; never throws. */
  release(): Promise<void>
}

type ManagerDeps = {
  /** Test seam: override the host-side shared-volume root. Defaults to `OM_OPENCODE_WORKSPACE_ROOT`. */
  workspaceRoot?: string
  /** Test seam: override the container-side root. Defaults to `OM_OPENCODE_WORKSPACE_ROOT_CONTAINER`. */
  containerRoot?: string
  /** Test seam: override the concurrency cap. Defaults to `OM_OPENCODE_POOL_SIZE`. */
  poolSize?: number
  /** Test seam: override the force-reclaim timeout. Defaults to `OM_OPENCODE_LEASE_TIMEOUT_MS`. */
  leaseTimeoutMs?: number
}

export class AgentWorkspaceManager {
  private readonly workspaceRoot: string
  private readonly containerRoot: string
  private readonly poolSize: number
  private readonly leaseTimeoutMs: number
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(deps: ManagerDeps = {}) {
    this.workspaceRoot = deps.workspaceRoot ?? resolveWorkspaceRoot()
    this.containerRoot = deps.containerRoot ?? resolveContainerRoot()
    this.poolSize = deps.poolSize ?? resolvePoolSize()
    this.leaseTimeoutMs = deps.leaseTimeoutMs ?? resolveLeaseTimeoutMs()
  }

  /**
   * Acquire a lease keyed by the run's session token: wait for a free slot, then
   * create `<root>/<sessionToken>/{in,out}`. The returned `release()` wipes the
   * subdir and frees the slot. A force-reclaim timer releases the slot if the
   * lease is held past `leaseTimeoutMs` (backstop against a wedged run) — the
   * runner's own wall-clock deadline normally releases first.
   */
  async acquire(sessionToken: string): Promise<AgentWorkspaceLease> {
    const safeToken = sanitizeToken(sessionToken)
    await this.takeSlot()

    const root = path.join(this.workspaceRoot, safeToken)
    const inDir = path.join(root, 'in')
    const outDir = path.join(root, 'out')
    // Container paths are always POSIX (the OpenCode container is Linux) regardless
    // of the OM host OS, so the agent is told a valid container path.
    const containerRoot = path.posix.join(this.containerRoot, safeToken)
    const containerInDir = path.posix.join(containerRoot, 'in')
    const containerOutDir = path.posix.join(containerRoot, 'out')
    try {
      await mkdir(inDir, { recursive: true })
      await mkdir(outDir, { recursive: true })
    } catch (err) {
      this.freeSlot()
      throw new Error(`[internal] failed to create agent workspace at ${root}: ${(err as Error).message}`)
    }

    let released = false
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      console.warn(`[internal] agent workspace lease timed out; force-reclaiming ${root}`)
      void doRelease()
    }, this.leaseTimeoutMs)
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }

    const doRelease = async (): Promise<void> => {
      if (released) return
      released = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      try {
        await rm(root, { recursive: true, force: true })
      } catch (err) {
        console.warn(`[internal] failed to wipe agent workspace ${root}:`, err)
      } finally {
        this.freeSlot()
      }
    }

    return { root, inDir, outDir, containerInDir, containerOutDir, release: doRelease }
  }

  private takeSlot(): Promise<void> {
    if (this.active < this.poolSize) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private freeSlot(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiters.shift()
    if (next) next()
  }
}

/** Keep the token to a filesystem-safe basename so it can never escape the root. */
function sanitizeToken(token: string): string {
  const cleaned = token.replace(/[^a-zA-Z0-9_-]+/g, '')
  if (!cleaned) throw new Error('[internal] agent workspace requires a non-empty session token')
  return cleaned
}
