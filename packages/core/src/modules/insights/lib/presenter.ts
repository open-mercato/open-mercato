import type { CausationFrame, CauseKind } from '@open-mercato/shared/lib/causation/types'
import type { ExplainConfidence, ExplainValueKind } from '@open-mercato/shared/modules/insights/explain'
import type {
  ExplainActorView,
  ExplainCauseFrameView,
  ExplainCauseView,
  ExplainCausedByView,
  ExplainChainEntryView,
  ExplainPrincipalView,
  ExplainValueView,
  ExplainViewerView,
} from '../data/validators'
import { toResponseValue, type EngineCause, type EngineChainEntry, type ResolvedValue } from './engine'
import {
  CODE_IDENTIFIER_CAUSE_KINDS,
  LOG_CAUSE_KINDS,
  PRINCIPAL_CAUSE_KINDS,
  type CauseDetailIndex,
  type ReferenceDetailIndex,
} from './causes'
import type { ExplainViewer, ExplainVisibility } from './viewer'

export type ActorKind = 'user' | 'api_key' | 'system'

export type PresenterContext = {
  viewer: ExplainViewer
  visibility: ExplainVisibility
  causes: CauseDetailIndex
  visibleLogIds: ReadonlySet<string>
  userLabels: ReadonlyMap<string, string>
  actorKinds: ReadonlyMap<string, ActorKind>
}

export function presentViewer(visibility: ExplainVisibility): ExplainViewerView {
  return {
    canSeeActors: visibility.canSeeActors,
    canSeePastValues: visibility.canSeePastValues,
    canSeeOwnValues: visibility.canSeeOwnValues,
  }
}

function isViewerPrincipal(context: PresenterContext, id: string | null): boolean {
  return id !== null && context.viewer.subject.kind === 'user' && context.viewer.subject.storageId === id
}

export function presentFrame(
  context: PresenterContext,
  kind: CauseKind,
  id: string | null,
  ref: string | null,
): ExplainCauseFrameView {
  if (PRINCIPAL_CAUSE_KINDS.has(kind)) {
    const visible = id === null || context.visibility.canSeeActors || isViewerPrincipal(context, id)
    return {
      kind,
      id: visible ? id : null,
      ref: null,
      label: visible && id ? context.userLabels.get(id) ?? null : null,
      href: null,
      available: visible,
    }
  }
  if (LOG_CAUSE_KINDS.has(kind)) {
    const available = id !== null && context.visibleLogIds.has(id)
    return { kind, id: available ? id : null, ref: null, label: null, href: null, available }
  }
  if (CODE_IDENTIFIER_CAUSE_KINDS.has(kind) && !context.causes.registeredKinds.has(kind)) {
    return { kind, id, ref, label: id ?? ref, href: null, available: true }
  }
  const detail = context.causes.get(kind, id)
  if (!detail) return { kind, id: null, ref: null, label: null, href: null, available: false }
  return { kind, id, ref, label: detail.label, href: detail.href, available: true }
}

function causeLabelKey(cause: EngineCause): string {
  if (cause.legacy) return cause.kind === 'user' ? 'insights.explain.cause.legacyUser' : 'insights.explain.cause.legacy'
  if (cause.derivedFromActor) return 'insights.explain.cause.derivedFromActor'
  return `insights.explain.causeKinds.${cause.kind}`
}

export function presentCause(context: PresenterContext, cause: EngineCause): ExplainCauseView {
  const frame = presentFrame(context, cause.kind, cause.id, cause.ref)
  const detail = context.causes.get(cause.kind, cause.id)
  return {
    ...frame,
    labelKey: frame.available && detail?.labelKey ? detail.labelKey : causeLabelKey(cause),
    legacy: cause.legacy,
    derivedFromActor: cause.derivedFromActor,
    frames: cause.frames.map((item: CausationFrame) => presentFrame(context, item.kind, item.id ?? null, item.ref ?? null)),
  }
}

export function presentActor(context: PresenterContext, logId: string, actorUserId: string | null): ExplainActorView {
  const kind: ActorKind = context.actorKinds.get(logId) ?? (actorUserId ? 'user' : 'system')
  if (!actorUserId || kind === 'system') {
    return { kind: 'system', id: null, label: null, isSelf: false, redacted: false }
  }
  const isSelf = context.viewer.subject.kind === kind && context.viewer.subject.storageId === actorUserId
  const visible = context.visibility.canSeeActors || isSelf
  return {
    kind,
    id: visible ? actorUserId : null,
    label: visible && kind === 'user' ? context.userLabels.get(actorUserId) ?? null : null,
    isSelf,
    redacted: !visible,
  }
}

export function presentPrincipal(context: PresenterContext, userId: string | null): ExplainPrincipalView | null {
  if (!userId) return null
  const isSelf = isViewerPrincipal(context, userId)
  const visible = context.visibility.canSeeActors || isSelf
  return {
    id: visible ? userId : null,
    label: visible ? context.userLabels.get(userId) ?? null : null,
    isSelf,
    redacted: !visible,
  }
}

export function presentValue(
  resolved: ResolvedValue,
  valueKind: ExplainValueKind,
  showValues: boolean,
  references: ReferenceDetailIndex,
): ExplainValueView | null {
  if (!resolved.known || resolved.source === 'none') return null
  if (!showValues) return { value: null, display: null, valueKind, source: resolved.source, redacted: true }
  return {
    value: toResponseValue(resolved.value),
    display: references.get(resolved.value)?.label ?? null,
    valueKind,
    source: resolved.source,
    redacted: false,
  }
}

export function presentCausedBy(
  context: PresenterContext,
  entry: Pick<EngineChainEntry, 'causedByLogId' | 'danglingCausedBy' | 'cause'>,
  actorIsSelf: boolean,
): ExplainCausedByView | null {
  if (!entry.causedByLogId) return null
  const principalHidden = PRINCIPAL_CAUSE_KINDS.has(entry.cause.kind) && !context.visibility.canSeeActors && !actorIsSelf
  const available = !principalHidden && !entry.danglingCausedBy && context.visibleLogIds.has(entry.causedByLogId)
  return { logId: available ? entry.causedByLogId : null, available }
}

export function canSeeEntryValues(visibility: ExplainVisibility, actorIsSelf: boolean): boolean {
  return visibility.canSeePastValues || (actorIsSelf && visibility.canSeeOwnValues)
}

export function presentChainEntry(
  context: PresenterContext,
  entry: EngineChainEntry,
  valueKind: ExplainValueKind,
  references: ReferenceDetailIndex,
): ExplainChainEntryView {
  const actor = presentActor(context, entry.logId, entry.actorUserId)
  const showValues = canSeeEntryValues(context.visibility, actor.isSelf)
  const view: ExplainChainEntryView = {
    logId: entry.logId,
    at: entry.at,
    state: entry.state,
    action: entry.actionType,
    commandId: entry.commandId,
    from: presentValue(entry.from, valueKind, showValues, references),
    to: presentValue(entry.to, valueKind, showValues, references),
    actor,
    onBehalfOf: presentPrincipal(context, entry.onBehalfOfUserId),
    cause: presentCause(context, entry.cause),
    causedBy: presentCausedBy(context, entry, actor.isSelf),
    correlationId: entry.correlationId,
    undoneBy: entry.undoneBy,
    confidence: entry.confidence,
  }
  if (entry.origin) view.origin = presentCause(context, entry.origin)
  if (entry.orderUncertain) view.orderUncertain = true
  if (entry.stale) view.stale = true
  return view
}

export function singleEntryConfidence(cause: EngineCause, danglingCausedBy: boolean): ExplainConfidence {
  if (cause.legacy) return cause.kind === 'unknown' ? 'unknown' : 'inferred'
  if (cause.kind === 'unknown') return 'unknown'
  if (!cause.envelopeVerified || cause.derivedFromActor || danglingCausedBy) return 'inferred'
  return 'proven'
}
