import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ZodError } from 'zod'
import {
  subscriptionPlans,
  subscriptionPlansManifestSchema,
  type SubscriptionPlanManifest,
} from '../plans'

export type ResolvedSubscriptionPlanManifest = {
  manifest: SubscriptionPlanManifest[]
  source: 'builtin' | 'file'
  manifestPath: string | null
}

const MANIFEST_ENV_KEY = 'OM_SUBSCRIPTIONS_PLANS_FILE'

function resolveConfiguredManifestPath(explicitPath?: string | null): string | null {
  const candidate = explicitPath?.trim() || process.env[MANIFEST_ENV_KEY]?.trim() || null
  if (!candidate) return null
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate)
}

function extractManifestCandidate(input: unknown): unknown {
  if (Array.isArray(input)) return input
  if (!input || typeof input !== 'object') return undefined

  const record = input as Record<string, unknown>
  for (const key of ['subscriptionPlans', 'plans', 'manifest']) {
    if (Array.isArray(record[key])) return record[key]
  }

  if ('default' in record) {
    return extractManifestCandidate(record.default)
  }

  for (const key of ['subscriptionPlans', 'plans', 'manifest']) {
    if (key in record) {
      const nested = extractManifestCandidate(record[key])
      if (nested !== undefined) return nested
    }
  }

  return undefined
}

async function loadManifestModule(resolvedPath: string): Promise<unknown> {
  if (path.extname(resolvedPath).toLowerCase() === '.json') {
    return JSON.parse(await fs.readFile(resolvedPath, 'utf8')) as unknown
  }
  return await import(pathToFileURL(resolvedPath).href)
}

export async function resolveSubscriptionPlanManifest(options?: {
  manifestPath?: string | null
}): Promise<ResolvedSubscriptionPlanManifest> {
  const resolvedPath = resolveConfiguredManifestPath(options?.manifestPath)
  if (!resolvedPath) {
    return {
      manifest: subscriptionPlans,
      source: 'builtin',
      manifestPath: null,
    }
  }

  let loaded: unknown
  try {
    loaded = await loadManifestModule(resolvedPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`subscriptions.plan-manifest: failed to load manifest file at ${resolvedPath}: ${message}`)
  }

  const candidate = extractManifestCandidate(loaded)
  if (candidate === undefined) {
    throw new Error(
      `subscriptions.plan-manifest: ${resolvedPath} must export an array via default export or named export "subscriptionPlans", "plans", or "manifest"`,
    )
  }

  try {
    return {
      manifest: subscriptionPlansManifestSchema.parse(candidate),
      source: 'file',
      manifestPath: resolvedPath,
    }
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(
        `subscriptions.plan-manifest: invalid manifest file at ${resolvedPath}: ${error.issues.map((issue) => issue.message).join('; ')}`,
      )
    }
    throw error
  }
}

