import { z } from 'zod'

/** `package.json` → `openMercato.webResearchAdapter`. */
export const MANIFEST_NAMESPACE = 'openMercato'
export const ADAPTER_MANIFEST_KEY = 'webResearchAdapter'

export const adapterManifestSchema = z.object({
  id: z.string().min(1).max(64),
  /** Import specifier relative to the package root; defaults to the package main. */
  entry: z.string().min(1).optional(),
})

export type AdapterManifest = z.infer<typeof adapterManifestSchema>

type PackageJsonLike = {
  readonly name?: unknown
  readonly [MANIFEST_NAMESPACE]?: unknown
}

/**
 * Reads the adapter manifest out of a parsed `package.json`. Returns null for any
 * package that simply is not an adapter, and only reports a problem when a
 * package claims to be one but declares it wrongly.
 */
export function readAdapterManifest(
  packageJson: unknown,
): { manifest: AdapterManifest; packageName: string } | { error: string } | null {
  if (typeof packageJson !== 'object' || packageJson === null) return null
  const parsed = packageJson as PackageJsonLike
  const namespace = parsed[MANIFEST_NAMESPACE]
  if (typeof namespace !== 'object' || namespace === null) return null
  const raw = (namespace as Record<string, unknown>)[ADAPTER_MANIFEST_KEY]
  if (raw === undefined) return null

  const packageName = typeof parsed.name === 'string' ? parsed.name : ''
  if (packageName.length === 0) {
    return { error: 'package declares a web-research adapter but has no name' }
  }
  const result = adapterManifestSchema.safeParse(raw)
  if (!result.success) {
    return { error: `${packageName} has an invalid ${MANIFEST_NAMESPACE}.${ADAPTER_MANIFEST_KEY}: ${result.error.message}` }
  }
  return { manifest: result.data, packageName }
}
