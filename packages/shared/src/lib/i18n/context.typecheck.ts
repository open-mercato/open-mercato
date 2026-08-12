// Compile-time-only regression guard for issue #5155. Never imported at
// runtime: `yarn typecheck` (`tsc --noEmit`) is the only gate that can catch
// a regression here, because this repo's Jest transform runs with
// `isolatedModules: true` and therefore skips type diagnostics — a test in
// `__tests__/context.test.tsx` would keep passing even if `children` became
// required again.
import * as React from 'react'
import { I18nProvider } from './context'

function assertI18nProviderAcceptsPositionalChildren() {
  return React.createElement(I18nProvider, { locale: 'en', dict: {} }, null)
}

void assertI18nProviderAcceptsPositionalChildren
