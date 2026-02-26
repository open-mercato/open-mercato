'use client'

import * as React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'

export function ComponentOverrideProvider({
  overrides,
  children,
}: {
  overrides: ComponentOverride[]
  children: React.ReactNode
}) {
  React.useEffect(() => {
    registerComponentOverrides(overrides)
  }, [overrides])

  return <>{children}</>
}

export default ComponentOverrideProvider
