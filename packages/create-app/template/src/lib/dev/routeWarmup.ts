import { apiRoutes } from '@/.mercato/generated/api-routes.generated'
import { backendRoutes } from '@/.mercato/generated/backend-routes.generated'
import { frontendRoutes } from '@/.mercato/generated/frontend-routes.generated'

type WarmScope = 'off' | 'common' | 'all'
type WarmKind = 'frontend' | 'backend' | 'api'

type WarmTask = {
  id: string
  kind: WarmKind
  path: string
  score: number
  run: () => Promise<unknown>
}

const STARTED_KEY = '__openMercatoDevRouteWarmupStarted__'
const DEFAULT_DELAY_MS = 3000
const DEFAULT_CONCURRENCY = 1

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function resolveWarmScope(): WarmScope {
  const raw = process.env.MERCATO_DEV_WARM?.trim().toLowerCase()
  if (!raw || raw === '1' || raw === 'true' || raw === 'common') return 'common'
  if (raw === '0' || raw === 'false' || raw === 'off') return 'off'
  if (raw === 'all') return 'all'
  return 'common'
}

function isStaticPath(pathname: string): boolean {
  return pathname.length > 0 && !pathname.includes('[')
}

function scorePath(kind: WarmKind, pathname: string, priority?: number): number {
  const normalized = pathname === '' ? '/' : pathname
  const segments = normalized.split('/').filter(Boolean)
  const rootBonus = normalized === '/' ? -500 : 0
  const loginBonus = normalized === '/login' ? -450 : 0
  const backendBonus = normalized === '/backend' ? -400 : 0
  const apiBonus = kind === 'api' ? 40 : 0
  const priorityScore = typeof priority === 'number' ? priority : 1000
  return priorityScore + segments.length * 10 + apiBonus + rootBonus + loginBonus + backendBonus
}

function pickCommonTasks(tasks: WarmTask[]): WarmTask[] {
  const frontend = tasks.filter((task) => task.kind === 'frontend').slice(0, 12)
  const backend = tasks.filter((task) => task.kind === 'backend').slice(0, 32)
  const api = tasks.filter((task) => task.kind === 'api').slice(0, 48)
  return [...frontend, ...backend, ...api]
}

function buildTasks(scope: WarmScope): WarmTask[] {
  const candidates: WarmTask[] = []

  for (const route of frontendRoutes) {
    const path = route.pattern ?? route.path ?? '/'
    if (!isStaticPath(path)) continue
    candidates.push({
      id: `frontend:${path}`,
      kind: 'frontend',
      path,
      score: scorePath('frontend', path, route.priority ?? route.order),
      run: () => route.load(),
    })
  }

  for (const route of backendRoutes) {
    const path = route.pattern ?? route.path ?? '/'
    if (!isStaticPath(path)) continue
    candidates.push({
      id: `backend:${path}`,
      kind: 'backend',
      path,
      score: scorePath('backend', path, route.priority ?? route.order),
      run: () => route.load(),
    })
  }

  for (const route of apiRoutes) {
    if (!route.methods.includes('GET')) continue
    if (!isStaticPath(route.path)) continue
    candidates.push({
      id: `api:${route.path}:${route.methods.join(',')}`,
      kind: 'api',
      path: route.path,
      score: scorePath('api', route.path),
      run: () => route.load(),
    })
  }

  const deduped = Array.from(
    candidates
      .sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))
      .reduce((map, task) => {
        if (!map.has(task.id)) map.set(task.id, task)
        return map
      }, new Map<string, WarmTask>())
      .values()
  )

  if (scope === 'all') {
    const limit = readPositiveInt(process.env.MERCATO_DEV_WARM_LIMIT, deduped.length)
    return deduped.slice(0, limit)
  }

  const common = pickCommonTasks(deduped)
  const limit = readPositiveInt(process.env.MERCATO_DEV_WARM_LIMIT, common.length)
  return common.slice(0, limit)
}

async function runTasks(tasks: WarmTask[]): Promise<void> {
  const concurrency = readPositiveInt(process.env.MERCATO_DEV_WARM_CONCURRENCY, DEFAULT_CONCURRENCY)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const current = tasks[nextIndex]
      nextIndex += 1
      try {
        await current.run()
      } catch (error) {
        console.warn(`[dev-warmup] Failed to warm ${current.kind} route "${current.path}":`, error)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()))
}

async function startWarmup(): Promise<void> {
  const { bootstrap } = await import('@/bootstrap')
  bootstrap()

  const scope = resolveWarmScope()
  if (scope === 'off') return

  const tasks = buildTasks(scope)
  if (tasks.length === 0) return

  console.log(`[dev-warmup] Warming ${tasks.length} lazy routes (${scope})`)
  await runTasks(tasks)
}

export function scheduleDevRouteWarmup(): void {
  if (process.env.NODE_ENV !== 'development') return
  const scope = resolveWarmScope()
  if (scope === 'off') return

  const globalState = globalThis as Record<string, unknown>
  if (globalState[STARTED_KEY]) return
  globalState[STARTED_KEY] = true

  const delayMs = readPositiveInt(process.env.MERCATO_DEV_WARM_DELAY_MS, DEFAULT_DELAY_MS)
  const timer = setTimeout(() => {
    void startWarmup()
  }, delayMs)
  timer.unref?.()
}
