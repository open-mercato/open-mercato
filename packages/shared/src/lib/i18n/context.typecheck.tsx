// Compile-time-only regression guard for issue #5155. Never imported at
// runtime: `yarn typecheck` (`tsc --noEmit`) is the only gate that can catch
// a regression here, because this repo's Jest transform runs with
// `isolatedModules: true` and therefore skips type diagnostics — a test in
// `__tests__/context.test.tsx` would keep passing even if `children` became
// required again.
//
// It sits outside `__tests__` because `packages/shared/tsconfig.json` excludes
// that directory from `tsc --noEmit`, and it is a `.tsx` rather than a `.ts`
// because the mutation gate mutates changed `src/lib/**/*.ts` files and runs
// only their related Jest tests (`enableFindRelatedTests`). A file that exists
// purely for the type checker has no related tests by construction, so Stryker
// aborts the run with "No tests were executed"; `.tsx` is already out of that
// scope by design — see `scripts/stryker/scope.mjs`.
import * as React from 'react'
import { I18nProvider } from './context'

function acceptsChildrenPositionally() {
  return React.createElement(I18nProvider, { locale: 'en', dict: {} }, <span />)
}

function acceptsNoChildren() {
  return React.createElement(I18nProvider, { locale: 'en', dict: {} })
}

function acceptsChildrenAsJsx() {
  return (
    <I18nProvider locale="en" dict={{}}>
      <span />
    </I18nProvider>
  )
}

void acceptsChildrenPositionally
void acceptsNoChildren
void acceptsChildrenAsJsx
