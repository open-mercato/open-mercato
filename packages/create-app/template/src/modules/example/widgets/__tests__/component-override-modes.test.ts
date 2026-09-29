/**
 * @jest-environment node
 */
/**
 * `widgets/components.ts` declaring a `replace` and a `props` entry is only worth
 * something if the platform composes them the way the file claims. These cases register
 * the REAL exported array through `registerComponentOverrides` and render it through
 * BOTH platform resolvers, because the platform has two and they do not compose alike:
 *
 * - `useRegisteredComponent` (`@open-mercato/ui/backend/injection`) is what
 *   `ComponentOverrideShowcase` — the host this module ships — calls. It PARTITIONS the
 *   matches into replacement / wrapper / transform buckets, so a props transform always
 *   reaches the render regardless of where it sorted, and the LAST replacement wins.
 * - `resolveRegisteredComponent` (`@open-mercato/shared/modules/widgets/component-registry`)
 *   is the server-side fold the backend catch-all uses for `page:` handles. It walks the
 *   matches in one pass and assigns `resolved = override.replacement`, DISCARDING
 *   everything composed before it — so there a transform that sorts ahead of the
 *   replacement is thrown away.
 *
 * The module's declared priorities (replace 40, props 50) are what make the two agree.
 * `the two resolvers agree under the declared priorities` is the case that fails if
 * somebody reorders them; `the two resolvers diverge once the replacement sorts last`
 * is the proof that the divergence is real and not a hypothetical.
 *
 * Kept apart from `components.test.ts` on purpose: that file calls
 * `jest.resetModules()` to reload the overrides under both states of the checkout demo
 * flag, which yields a SECOND React instance whose hooks cannot render inside a
 * provider created by the first. Rendering therefore has to happen against statically
 * imported modules.
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  registerComponentOverrides,
  resolveRegisteredComponent,
  type ComponentOverride,
} from '@open-mercato/shared/modules/widgets/component-registry'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import englishCatalog from '../../i18n/en.json'
import {
  ComponentOverrideShowcase,
  OVERRIDE_SHOWCASE_HANDLE,
  OverrideShowcaseBase,
  withOverridingModule,
} from '../../components/ComponentOverrideShowcase'
import { componentOverrides, OVERRIDING_MODULE_ID, stampOverridingModule } from '../components'

const catalog = englishCatalog as Record<string, string>

const HostFallback = (props: unknown) =>
  React.createElement(
    'div',
    { 'data-testid': 'host-fallback' },
    String((props as { recordCount?: number }).recordCount ?? ''),
  )
HostFallback.displayName = 'HostFallback'

function inI18n(element: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { locale: 'en', dict: catalog }, element),
  )
}

/** The shipped path: the module's own client host, resolving through `useRegisteredComponent`. */
function renderThroughHost(overrides: ComponentOverride[] = componentOverrides): string {
  registerComponentOverrides(overrides)
  return inI18n(React.createElement(ComponentOverrideShowcase, { recordCount: 3 }))
}

/** The server path: the single-pass fold the backend catch-all uses for `page:` handles. */
function renderThroughServerResolver(
  overrides: ComponentOverride[] = componentOverrides,
  fallback: React.ComponentType<{ recordCount: number }> = HostFallback,
): string {
  registerComponentOverrides(overrides)
  const Resolved = resolveRegisteredComponent<{ recordCount: number }>(
    OVERRIDE_SHOWCASE_HANDLE,
    fallback,
  )
  return inI18n(React.createElement(Resolved, { recordCount: 3 }))
}

/** Same entries, with the replacement pushed above the props transform. */
function withReplacementSortedLast(): ComponentOverride[] {
  const transformPriority = componentOverrides
    .filter((override) => override.target.componentId === OVERRIDE_SHOWCASE_HANDLE && 'propsTransform' in override)
    .map((override) => override.priority)[0]
  return componentOverrides.map((override) => (
    'replacement' in override && override.target.componentId === OVERRIDE_SHOWCASE_HANDLE
      ? { ...override, priority: transformPriority + 10 }
      : override
  ))
}

const NOTE_APPLIED = catalog['example.componentOverrides.note'].replace('{module}', OVERRIDING_MODULE_ID)
const NOTE_MISSING = catalog['example.componentOverrides.noteMissing']

describe('example showcase overrides through the resolver the host ships', () => {
  afterEach(() => {
    registerComponentOverrides([])
  })

  /**
   * `widgets/components.ts` rebuilds the handle from the framework builder instead of
   * importing this constant, because the fact extractor cannot follow a cross-file
   * identifier. This pins the two spellings together so the workaround cannot rot.
   */
  it('targets exactly the handle the host component exposes', () => {
    const targeted = componentOverrides
      .filter((override) => override.target.componentId === OVERRIDE_SHOWCASE_HANDLE)
    expect(targeted).toHaveLength(2)
    expect(OVERRIDE_SHOWCASE_HANDLE).toBe('section:example.overrides.showcase')
  })

  /**
   * `useRegisteredComponent` names `metadata.module` in the props-schema-failure and
   * error-boundary log lines, and reports `'unknown'` when it is absent — so dropping it
   * turns a diagnosable override failure into an anonymous one.
   */
  it('attributes every override on the handle to the module that declares it', () => {
    const targeted = componentOverrides
      .filter((override) => override.target.componentId === OVERRIDE_SHOWCASE_HANDLE)
    expect(targeted.map((override) => override.metadata?.module))
      .toEqual([OVERRIDING_MODULE_ID, OVERRIDING_MODULE_ID])
  })

  it('replaces the host implementation instead of decorating it', () => {
    const markup = renderThroughHost()
    expect(markup).toContain(`data-component-handle="${OVERRIDE_SHOWCASE_HANDLE}"`)
    expect(markup).toContain('data-testid="example-override-showcase-replacement"')
    expect(markup).not.toContain('data-testid="example-override-showcase-base"')
  })

  it('feeds the replacement the transformed props', () => {
    const markup = renderThroughHost()
    expect(markup).toContain(NOTE_APPLIED)
    expect(markup).not.toContain(NOTE_MISSING)
  })

  it('renders the host-supplied prop the transform preserved', () => {
    const markup = renderThroughHost()
    expect(markup).toContain(catalog['example.componentOverrides.recordCount'].replace('{count}', '3'))
  })

  /**
   * The negative control for the case above: with the `props` entry removed, the same
   * replacement renders the "no transform reached this render" line. Without it, the
   * transform assertion could pass on copy that happens to contain the module id.
   */
  it('renders the missing-transform line when the props override is absent', () => {
    const withoutTransform = componentOverrides.filter((override) => !('propsTransform' in override))
    expect(withoutTransform.length).toBe(componentOverrides.length - 1)
    expect(renderThroughHost(withoutTransform)).toContain(NOTE_MISSING)
  })

  /**
   * The other negative control: with the `replace` entry removed, the host's own
   * implementation renders instead, so the replacement assertion is not tautological.
   */
  it('falls back to the host implementation when the replace override is absent', () => {
    const withoutReplacement = componentOverrides.filter((override) => !('replacement' in override))
    expect(withoutReplacement.length).toBe(componentOverrides.length - 1)
    const markup = renderThroughHost(withoutReplacement)
    expect(markup).toContain('data-testid="example-override-showcase-base"')
    expect(markup).not.toContain('data-testid="example-override-showcase-replacement"')
  })

  it('leaves props it cannot recognise untouched', () => {
    const scalar = 'not-an-object'
    expect(withOverridingModule(scalar, OVERRIDING_MODULE_ID)).toBe(scalar)
    expect(withOverridingModule(null, OVERRIDING_MODULE_ID)).toBeNull()
    expect(stampOverridingModule({ recordCount: 1 }))
      .toEqual({ recordCount: 1, overriddenBy: OVERRIDING_MODULE_ID })
  })
})

describe('example showcase overrides across both platform resolvers', () => {
  afterEach(() => {
    registerComponentOverrides([])
  })

  /**
   * The reason the declared priorities are what they are. Under `replace 40 / props 50`
   * the server fold reaches the transform before the replacement overwrites the chain,
   * so both resolvers render the transformed note. Raise the replacement above the
   * transform and this case fails on the server side while the client side keeps
   * passing — which is exactly the divergence the next case pins.
   */
  it('agrees under the declared priorities, which is why replace sorts first', () => {
    expect(renderThroughHost()).toContain(NOTE_APPLIED)
    expect(renderThroughServerResolver()).toContain(NOTE_APPLIED)
    expect(renderThroughServerResolver()).not.toContain(NOTE_MISSING)
  })

  /**
   * Same entries, replacement pushed last. `useRegisteredComponent` buckets the
   * transform separately and still applies it; `resolveRegisteredComponent` folds
   * sequentially and throws it away. Nothing about the module changes — only which
   * resolver reads it.
   */
  it('diverges once the replacement sorts after the transform', () => {
    const reordered = withReplacementSortedLast()
    expect(renderThroughHost(reordered)).toContain(NOTE_APPLIED)
    expect(renderThroughServerResolver(reordered)).toContain(NOTE_MISSING)
    expect(renderThroughServerResolver(reordered)).not.toContain(NOTE_APPLIED)
  })

  /**
   * The other documented difference: the client resolver keeps the LAST replacement it
   * sees, the server fold likewise ends on the last one — but the server fold also
   * discards any wrapper that sorted between them, so a second replacement is not a
   * neutral addition on either path. Pinned so the doc claim is testable.
   */
  it('keeps the highest-priority replacement when two are registered', () => {
    const SecondReplacement: React.ComponentType<unknown> = () =>
      React.createElement('div', { 'data-testid': 'second-replacement' })
    SecondReplacement.displayName = 'SecondReplacement'
    const replaceEntry = componentOverrides
      .find((override) => 'replacement' in override && override.target.componentId === OVERRIDE_SHOWCASE_HANDLE)
    const second = { ...replaceEntry, priority: 90, replacement: SecondReplacement } as ComponentOverride

    const markup = renderThroughHost([...componentOverrides, second])
    expect(markup).toContain('data-testid="second-replacement"')
    expect(markup).not.toContain('data-testid="example-override-showcase-replacement"')
  })

  /**
   * `resolveRegisteredComponent` has no registry entry to fall back to, so the caller
   * supplies one; the host passes `OverrideShowcaseBase`. Proves the two paths share the
   * same fallback implementation rather than diverging on the no-override case too.
   */
  it('renders the same host implementation on both paths when nothing overrides the handle', () => {
    expect(renderThroughHost([])).toContain('data-testid="example-override-showcase-base"')
    expect(renderThroughServerResolver([], OverrideShowcaseBase))
      .toContain('data-testid="example-override-showcase-base"')
  })
})
