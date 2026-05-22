"use client"

import type { AiUiPartComponent, AiUiPartProps } from '../ui-part-registry'
import { MutationPreviewCard } from './MutationPreviewCard'
import { FieldDiffCard } from './FieldDiffCard'
import { ConfirmationCard } from './ConfirmationCard'
import { MutationResultCard } from './MutationResultCard'

/**
 * Canonical map of the four Phase 3 mutation-approval cards keyed by their
 * reserved registry component ids. Consumers can spread this into any
 * `AiUiPartRegistry` to wire the live cards at once. Isolated from
 * `parts/index.ts` so the `ui-part-registry` module can import the map
 * without importing the barrel (which would re-export back into the same
 * module and trip Node's "Cannot access before initialization" ordering).
 */
export const AI_MUTATION_APPROVAL_CARDS: Readonly<
  Record<string, AiUiPartComponent<AiUiPartProps>>
> = Object.freeze({
  'mutation-preview-card': MutationPreviewCard as AiUiPartComponent<AiUiPartProps>,
  'field-diff-card': FieldDiffCard as unknown as AiUiPartComponent<AiUiPartProps>,
  'confirmation-card': ConfirmationCard as AiUiPartComponent<AiUiPartProps>,
  'mutation-result-card': MutationResultCard as AiUiPartComponent<AiUiPartProps>,
})
