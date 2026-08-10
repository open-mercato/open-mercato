import * as React from 'react'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import {
  OverrideShowcaseReplacement,
  overrideShowcasePropsSchema,
  withOverridingModule,
} from '../components/ComponentOverrideShowcase'

const checkoutTestInjectionsEnabled = parseBooleanWithDefault(
  process.env.NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED,
  false,
)

type AnyComponent = React.ComponentType<unknown>

/**
 * Builds the decorating wrapper the demo overrides use.
 *
 * Exported as a pure function so the pass-through contract below is provable by
 * calling it, instead of by grepping this file for a literal.
 */
export function decorateWithDemoFrame(
  Original: AnyComponent,
  displayName: string,
  testId: string,
  className: string,
): AnyComponent {
  const WrappedSection = (props: unknown) =>
    React.createElement(
      'div',
      { className, 'data-testid': testId },
      React.createElement(Original, props as object)
    )
  WrappedSection.displayName = displayName
  return WrappedSection
}

/**
 * Pass-through gate for demo-only overrides.
 *
 * Both platform resolvers feed `wrapper(resolved)` straight back into the
 * resolution chain, so returning `Original` BY IDENTITY leaves the rendered
 * tree byte-identical to having no override registered at all. That is what
 * lets the override be DECLARED unconditionally — a statically foldable array
 * literal the fact extractor can read — while the demo chrome stays opt-in.
 */
export function applyWhenEnabled(
  enabled: boolean,
  Original: AnyComponent,
  decorate: (Original: AnyComponent) => AnyComponent,
): AnyComponent {
  return enabled ? decorate(Original) : Original
}

/** Module id the `props`-mode override stamps onto the showcase section's props. */
export const OVERRIDING_MODULE_ID = 'example'

/**
 * The showcase handle, declared LOCALLY rather than imported from
 * `components/ComponentOverrideShowcase.tsx`, which exports the same constant.
 *
 * What the fact extractor cannot do is follow an identifier across a file boundary:
 * `staticValue` resolves an identifier only against initializers declared in the file
 * it is reading, so an imported handle constant folds to `undefined` and the entry
 * publishes ZERO component-override contributions — the same class of silent-zero bug
 * the conditional-spread export used to cause. A plain string literal would fold too;
 * the builder is used because it keeps the `section:<scope>.<id>` spelling owned by the
 * framework instead of retyped here. `widgets/__tests__/component-override-modes.test.ts`
 * pins the two spellings to each other.
 */
const SHOWCASE_HANDLE = ComponentReplacementHandles.section('example.overrides', 'showcase')

/**
 * `props`-mode transform for the showcase section.
 *
 * It has to be declared in THIS file — as a function declaration or an inline arrow,
 * either folds identically — because `isFunctionLikeInitializer` classifies the entry as
 * `props` only when it can see the callable. Assigning an identifier imported from
 * another module (`withOverridingModule` itself, say) leaves `propsTransform` unresolved
 * and the extractor falls through to the `replace` default. Same cross-file limit as the
 * handle above; `widgets/__tests__/components.test.ts` asserts the resolved mode.
 */
export function stampOverridingModule(props: unknown): unknown {
  return withOverridingModule(props, OVERRIDING_MODULE_ID)
}

/**
 * Example module component overrides.
 *
 * Declared as ONE array literal with no env-flag branching on purpose: the fact
 * extractor (`packages/cli/src/lib/generators/module-extension-facts.ts` →
 * `extractObjectConvention` → `staticValue`) can only fold a statically known
 * value, so an export built by a conditional spread published ZERO
 * contributions and every scaffolded app read this canonical module as
 * contributing no component override at all.
 */
export const componentOverrides: ComponentOverride[] = [
  /**
   * The one entry with no `applyWhenEnabled` gate, and the deliberate exception to the rule the
   * `replace`-mode entry below states. Naming it here because a reader who takes that rule at face
   * value would not expect a counterexample four entries above it.
   *
   * Two things make it different in kind from a gated demo. It **composes** rather than replaces:
   * `decorateWithDemoFrame` renders the host's own component inside a border, so the screen you
   * came to look at is still the screen you get — a `replace` on a foreign handle would discard it.
   * And it is the subject of a guided lesson rather than incidental chrome: Phase H of
   * `/backend/example/umes-extensions` tells the reader to go and find this border on a customer
   * detail page (`example.umes.extensions.phaseH.hint4`), and `TC-UMES-004` asserts it renders.
   * Gating it would make both of those statements false.
   *
   * Its blast radius is this monorepo alone: a scaffolded app ships `src/modules/example` in source
   * and registers neither it nor the gallery, so nothing here loads until an app opts in — see
   * `packages/create-app/agentic/shared/ai/specs/2026-08-06-reference-module-activation.md`.
   */
  {
    target: { componentId: ComponentReplacementHandles.section('ui.detail', 'NotesSection') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => decorateWithDemoFrame(
      Original,
      'ExampleNotesSectionWrapper',
      'example-notes-wrapper',
      'rounded-md border border-dotted border-border/70 p-2',
    ),
  },
  {
    target: { componentId: ComponentReplacementHandles.section('checkout.pay-page', 'summary') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => applyWhenEnabled(
      checkoutTestInjectionsEnabled,
      Original,
      (Component) => decorateWithDemoFrame(
        Component,
        'ExampleCheckoutSummaryWrapper',
        'example-checkout-summary-wrapper',
        'rounded-2xl border border-dashed border-status-info-border bg-status-info-bg p-3',
      ),
    ),
  },
  {
    target: { componentId: ComponentReplacementHandles.section('checkout.pay-page', 'help') },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => applyWhenEnabled(
      checkoutTestInjectionsEnabled,
      Original,
      (Component) => decorateWithDemoFrame(
        Component,
        'ExampleCheckoutHelpWrapper',
        'example-checkout-help-wrapper',
        'rounded-2xl border border-dashed border-status-warning-border bg-status-warning-bg p-3',
      ),
    ),
  },
  /**
   * `replace` mode. Ordering matters, but WHICH resolver reads it decides how much.
   * `resolveRegisteredComponent` (the server fold behind `page:` handles) assigns
   * `resolved = override.replacement` mid-walk, discarding everything composed before
   * it, so a replacement at a HIGHER priority number silently throws away the wrappers
   * and transforms that sorted ahead of it. `useRegisteredComponent` — what the host
   * below actually calls — buckets the modes instead and applies the transforms to the
   * props regardless of order. Taking the lowest number on the handle is what makes the
   * two agree; `widgets/__tests__/component-override-modes.test.ts` renders both.
   *
   * The target is a handle this module hosts itself
   * (`components/ComponentOverrideShowcase.tsx`, rendered by
   * `/backend/component-overrides`). A production override in `replace` mode names a handle
   * another module exposes; a canonical reference module must not, because `replace` discards
   * the host's markup, so enabling this module for inspection would rewrite a screen you did not
   * come to look at. The rule is about **replacement**, not about touching a foreign handle at
   * all: the `wrapper` entries above do name foreign handles and keep the host's own component
   * rendered inside their frame, which is why the notes wrapper is a documented exception rather
   * than a violation.
   */
  {
    target: { componentId: SHOWCASE_HANDLE },
    priority: 40,
    metadata: { module: OVERRIDING_MODULE_ID },
    replacement: OverrideShowcaseReplacement,
    propsSchema: overrideShowcasePropsSchema,
  },
  /**
   * `props` mode. It is the only mode that changes what a host renders WITHOUT owning
   * its markup: the resolved component is kept and fed transformed props. It sorts
   * after the replacement above so the server fold reaches it too — on the client
   * resolver the order between the two is irrelevant.
   */
  {
    target: { componentId: SHOWCASE_HANDLE },
    priority: 50,
    metadata: { module: OVERRIDING_MODULE_ID },
    propsTransform: stampOverridingModule,
  },
]

export default componentOverrides
