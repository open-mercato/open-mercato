'use client'

import * as React from 'react'
import type { FormSectionPolicy } from '@open-mercato/shared/modules/overrides'
import { getFormSectionPolicy, subscribeToFormSectionPolicies } from '@open-mercato/shared/modules/overrides'

/**
 * The `overrides.forms.sections` policy configured for a CrudForm host, or
 * `null` when none is — which a host MUST read as "render and submit exactly as
 * shipped".
 *
 * This subscribes rather than reading once, because on the client the override
 * dispatcher runs inside `ensureModuleOverridesApplied()` — an awaited dynamic
 * import that resolves *after* first paint. A one-shot read would render the
 * full form and drop the hidden cards a tick later (a visible layout jump), and
 * would leave a window in which a fast submit ran with the wrong section set.
 *
 * `getServerSnapshot` returns `null` so the server render and the first client
 * render agree: the policy is a browser-side decision, and claiming one during
 * SSR would be a hydration mismatch.
 *
 * Non-React callers should use `getFormSectionPolicy` directly.
 */
export function useFormSectionPolicy(hostId: string): FormSectionPolicy | null {
  // `getFormSectionPolicy` hands back the stored object, whose identity is
  // stable until an applier replaces it, so `useSyncExternalStore`'s snapshot
  // comparison settles instead of looping.
  const getSnapshot = React.useCallback(() => getFormSectionPolicy(hostId), [hostId])
  const getServerSnapshot = React.useCallback(() => null, [])
  return React.useSyncExternalStore(subscribeToFormSectionPolicies, getSnapshot, getServerSnapshot)
}

export default useFormSectionPolicy
