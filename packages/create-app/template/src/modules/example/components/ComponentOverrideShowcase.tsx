"use client"
/**
 * Component-replacement HOST plus the replacement this module registers against it.
 *
 * Every other component-override example in the tree overrides a handle somebody else
 * exposes. This file is the other half: how a module *exposes* one, and why the host
 * has to be a client component.
 *
 * `registerComponentOverrides` is called from `ComponentOverrideProvider`, a client
 * component, so the override registry is only populated inside the client tree. The
 * server resolver (`resolveRegisteredComponent`, used by the backend catch-all for the
 * `page:` handle) reads the same module-global map but runs during the RSC pass, before
 * that provider has rendered. A handle you want overridable in practice therefore has
 * to be resolved through `useRegisteredComponent` from a client component — which is
 * exactly what `ComponentOverrideShowcase` does below.
 *
 * The two resolvers do NOT compose the same way, and the difference is the single most
 * misread thing about this mechanism:
 *
 * - `useRegisteredComponent` (this host) partitions the matches into buckets. The
 *   highest-priority `replacement` becomes the base, the `wrapper`s reduce over it in
 *   ascending priority, and every `propsTransform` is applied to the props at render
 *   time — so a transform reaches the render NO MATTER where it sorted relative to the
 *   replacement.
 * - `resolveRegisteredComponent` (the server fold) walks the matches in one pass and
 *   assigns `resolved = override.replacement`, discarding everything composed before
 *   it. There a `propsTransform` that sorts AHEAD of the replacement is thrown away.
 *
 * `widgets/components.ts` registers the `replacement` at priority 40 and the
 * `propsTransform` at 50, which makes both resolvers produce the same tree: the
 * replacement rendering a transformed prop, as seen on `/backend/component-overrides`.
 * Reordering them would change nothing here and silently drop the transform on the
 * server path — `widgets/__tests__/component-override-modes.test.ts` renders both and
 * fails on the divergence.
 */
import * as React from 'react'
import { z } from 'zod'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/** Stable handle other modules (and this one) target. Exported so nobody retypes it. */
export const OVERRIDE_SHOWCASE_HANDLE = ComponentReplacementHandles.section('example.overrides', 'showcase')

/**
 * Props contract of the handle, declared once as a Zod schema because the
 * `replacement` member of `ComponentOverride` requires a `propsSchema` alongside the
 * component: `useRegisteredComponent` runs it against the transformed props in
 * non-production builds and falls back to the host implementation when it fails, so a
 * replacement whose contract drifts degrades instead of crashing.
 */
export const overrideShowcasePropsSchema = z.object({
  /** Supplied by the hosting page. */
  recordCount: z.number(),
  /** Absent on the base render; injected by the `propsTransform` override. */
  overriddenBy: z.string().optional(),
})

export type OverrideShowcaseProps = z.infer<typeof overrideShowcasePropsSchema>

/**
 * Narrowing helper behind the `propsTransform` declaration, which the
 * `ComponentOverride` union types as `(props: unknown) => unknown`.
 *
 * Exported as a pure function so the transform is provable by calling it rather than
 * by rendering a tree. Non-object props are returned by identity, which is what makes
 * the transform safe to register against a host whose props shape it cannot see.
 */
export function withOverridingModule(props: unknown, moduleId: string): unknown {
  if (!props || typeof props !== 'object') return props
  return { ...(props as Record<string, unknown>), overriddenBy: moduleId }
}

/** The implementation the host falls back to when no override is registered. */
export function OverrideShowcaseBase({ recordCount }: OverrideShowcaseProps) {
  const t = useT()
  return (
    <div className="rounded-md border border-border p-4" data-testid="example-override-showcase-base">
      <div className="text-sm font-medium">
        {t('example.componentOverrides.base.title', 'Base section')}
      </div>
      <p className="text-sm text-muted-foreground">
        {t('example.componentOverrides.base.body', 'This is what the host renders when no override is registered for its handle.')}
      </p>
      <p className="text-sm">
        {t('example.componentOverrides.recordCount', 'Records in scope: {count}', { count: recordCount })}
      </p>
    </div>
  )
}

function OverrideShowcaseReplacementBody({ recordCount, overriddenBy }: OverrideShowcaseProps) {
  const t = useT()
  return (
    <div
      className="rounded-md border border-status-info-border bg-status-info-bg p-4"
      data-testid="example-override-showcase-replacement"
    >
      <div className="text-sm font-medium text-status-info-text">
        {t('example.componentOverrides.replacement.title', 'Replaced section')}
      </div>
      <p className="text-sm text-status-info-text">
        {t('example.componentOverrides.replacement.body', 'A replace-mode override discards the host implementation entirely, so the panel above is gone rather than decorated.')}
      </p>
      <p className="text-sm text-status-info-text">
        {t('example.componentOverrides.recordCount', 'Records in scope: {count}', { count: recordCount })}
      </p>
      <p className="text-sm text-status-info-text" data-testid="example-override-showcase-note">
        {overriddenBy
          ? t('example.componentOverrides.note', 'Props were transformed by: {module}', { module: overriddenBy })
          : t('example.componentOverrides.noteMissing', 'No props transform reached this render.')}
      </p>
    </div>
  )
}

function OverrideShowcaseInvalidProps() {
  const t = useT()
  return (
    <div className="rounded-md border border-status-warning-border bg-status-warning-bg p-4">
      <p className="text-sm text-status-warning-text" data-testid="example-override-showcase-invalid">
        {t('example.componentOverrides.invalidProps', 'The replacement received props that do not match its contract.')}
      </p>
    </div>
  )
}

/**
 * The component `widgets/components.ts` registers in `replace` mode.
 *
 * Its parameter is `unknown` and it parses, for the same reason the module's AI tool
 * handlers do: a replacement is handed whatever the host and every earlier
 * `propsTransform` produced, and the registry's own schema check is a development-only
 * guard. Typing it `ComponentType<unknown>` is also what makes it assignable to the
 * `ComponentOverride` union without a cast.
 */
export const OverrideShowcaseReplacement: React.ComponentType<unknown> = (props: unknown) => {
  const parsed = overrideShowcasePropsSchema.safeParse(props)
  if (!parsed.success) return <OverrideShowcaseInvalidProps />
  return <OverrideShowcaseReplacementBody {...parsed.data} />
}
OverrideShowcaseReplacement.displayName = 'ExampleOverrideShowcaseReplacement'

/**
 * The host. Resolves the handle through the client registry and renders whatever the
 * override chain produced, inside the `data-component-handle` marker every host in the
 * platform emits so a test can find it.
 */
export function ComponentOverrideShowcase(props: OverrideShowcaseProps) {
  const Resolved = useRegisteredComponent<OverrideShowcaseProps>(
    OVERRIDE_SHOWCASE_HANDLE,
    OverrideShowcaseBase,
  )
  return (
    <div data-component-handle={OVERRIDE_SHOWCASE_HANDLE}>
      <Resolved {...props} />
    </div>
  )
}

export default ComponentOverrideShowcase
