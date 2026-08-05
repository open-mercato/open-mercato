/**
 * Resolution of a page's authored `PageMetadata` into the flat `ModuleRouteMetadata`
 * shape that route manifests carry.
 *
 * This lives in its own module rather than in `registry.ts` so `overrides.ts` can reuse
 * it without an import cycle (`registry.ts` imports the override appliers). `registry.ts`
 * re-exports `resolvePageRouteMetadata` so its published import path stays valid.
 */
import type { ModuleRouteMetadata, PageMetadata } from './registry'

export function resolvePageRouteMetadata(pattern: string, metadata: PageMetadata | null | undefined): ModuleRouteMetadata {
  return {
    pattern: pattern || '/',
    requireAuth: metadata?.requireAuth,
    requireRoles: metadata?.requireRoles ? [...metadata.requireRoles] : undefined,
    requireFeatures: metadata?.requireFeatures ? [...metadata.requireFeatures] : undefined,
    requireCustomerAuth: metadata?.requireCustomerAuth,
    requireCustomerFeatures: metadata?.requireCustomerFeatures ? [...metadata.requireCustomerFeatures] : undefined,
    nav: metadata?.nav,
    title: metadata?.pageTitle ?? metadata?.title,
    titleKey: metadata?.pageTitleKey ?? metadata?.titleKey,
    group: metadata?.pageGroup ?? metadata?.group,
    groupKey: metadata?.pageGroupKey ?? metadata?.groupKey,
    icon: metadata?.icon,
    order: metadata?.pageOrder ?? metadata?.order,
    priority: metadata?.pagePriority ?? metadata?.priority,
    navHidden: metadata?.navHidden,
    visible: metadata?.visible,
    enabled: metadata?.enabled,
    breadcrumb: metadata?.breadcrumb,
    pageContext: metadata?.pageContext,
    placement: metadata?.placement,
  }
}

/**
 * The subset of `resolvePageRouteMetadata`'s output a caller actually declared.
 *
 * A page override supplies a partial `PageMetadata`, so merging the full resolved shape
 * would overwrite fields the override never mentioned with `undefined`. Dropping the
 * undefined entries keeps an override additive while still normalizing the `page*`
 * aliases (`pageOrder` → `order`, `pageTitle` → `title`, …) that the manifest reads (#4845).
 *
 * `pattern` is never part of the result: an override adjusts a route's metadata, never the
 * route key it was matched by.
 */
export function resolveDeclaredPageRouteMetadata(
  metadata: PageMetadata | null | undefined,
): Partial<ModuleRouteMetadata> {
  const { pattern: _pattern, ...resolved } = resolvePageRouteMetadata('/', metadata)
  const declared: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(resolved)) {
    if (value !== undefined) declared[key] = value
  }
  return declared as Partial<ModuleRouteMetadata>
}
