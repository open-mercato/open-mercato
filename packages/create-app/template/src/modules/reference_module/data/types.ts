import type { referenceTaskLinkTargetKinds, referenceTaskStatuses } from './validators'

export type ReferenceTaskStatus = (typeof referenceTaskStatuses)[number]
export type ReferenceTaskLinkTargetKind = (typeof referenceTaskLinkTargetKinds)[number]
