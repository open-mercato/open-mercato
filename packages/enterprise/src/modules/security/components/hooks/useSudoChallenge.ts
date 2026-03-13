import * as React from 'react'
import type { SudoTargetType } from '../../data/constants'
import { SudoContext } from '../SudoProvider'

export type UseSudoChallengeReturn = {
  requireSudo: (
    targetIdentifier: string,
    options?: { targetType?: SudoTargetType },
  ) => Promise<string | null>
  isSudoActive: boolean
}

export function useSudoChallenge(): UseSudoChallengeReturn {
  const context = React.useContext(SudoContext)
  if (!context) {
    throw new Error('useSudoChallenge must be used within a SudoProvider')
  }

  const requireSudo = React.useCallback<UseSudoChallengeReturn['requireSudo']>(
    (targetIdentifier, options) => context.requireSudo(targetIdentifier, options),
    [context],
  )

  return {
    requireSudo,
    isSudoActive: context.isSudoActive,
  }
}

export default useSudoChallenge
