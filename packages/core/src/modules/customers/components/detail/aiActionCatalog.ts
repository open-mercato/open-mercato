/**
 * Shared catalog of "coming soon" AI action chips used by both
 * ActivityAiActions (outline button chips on activity cards) and
 * AiActionChips (inline pipe-separated chips on timeline rows).
 *
 * Each presentation surface can subset / reorder the catalog.
 * Action handlers are intentionally absent — the UI is disabled
 * until the AI assistant wiring lands.
 */

import type { ComponentType, SVGProps } from 'react'
import { BarChart3, FileText, ListTodo, Mail, NotebookPen, Play, Reply, Sparkles, Users } from 'lucide-react'

export type AiActionKey =
  | 'ai'
  | 'summarize'
  | 'replay'
  | 'transcription'
  | 'actionItems'
  | 'showEmail'
  | 'reply'
  | 'sentiment'
  | 'notes'
  | 'attendees'
  | 'leadScore'
  | 'expand'
  | 'bulletize'
  | 'translate'

export type AiActionDefinition = {
  key: AiActionKey
  i18nKey: string
  fallback: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const AI_ACTION_DEFINITIONS: Record<AiActionKey, AiActionDefinition> = {
  ai: { key: 'ai', i18nKey: 'customers.ai.actions.ai', fallback: 'AI', icon: Sparkles },
  summarize: { key: 'summarize', i18nKey: 'customers.ai.actions.summarize', fallback: 'Summarize', icon: FileText },
  replay: { key: 'replay', i18nKey: 'customers.ai.actions.replay', fallback: 'Replay', icon: Play },
  transcription: { key: 'transcription', i18nKey: 'customers.ai.actions.transcription', fallback: 'Transcription', icon: NotebookPen },
  actionItems: { key: 'actionItems', i18nKey: 'customers.ai.actions.actionItems', fallback: 'Action items', icon: ListTodo },
  showEmail: { key: 'showEmail', i18nKey: 'customers.ai.actions.showEmail', fallback: 'Show email', icon: Mail },
  reply: { key: 'reply', i18nKey: 'customers.ai.actions.reply', fallback: 'Reply', icon: Reply },
  sentiment: { key: 'sentiment', i18nKey: 'customers.ai.actions.sentiment', fallback: 'Sentiment', icon: BarChart3 },
  notes: { key: 'notes', i18nKey: 'customers.ai.actions.notes', fallback: 'Notes', icon: NotebookPen },
  attendees: { key: 'attendees', i18nKey: 'customers.ai.actions.attendees', fallback: 'Attendees', icon: Users },
  leadScore: { key: 'leadScore', i18nKey: 'customers.ai.actions.leadScore', fallback: 'Lead score', icon: BarChart3 },
  expand: { key: 'expand', i18nKey: 'customers.ai.actions.expand', fallback: 'Expand', icon: Sparkles },
  bulletize: { key: 'bulletize', i18nKey: 'customers.ai.actions.bulletize', fallback: 'Bulletize', icon: ListTodo },
  translate: { key: 'translate', i18nKey: 'customers.ai.actions.translate', fallback: 'Translate', icon: Sparkles },
}

/** Per-activity-type action keys in card (outline chip) layout. */
export const AI_CARD_ACTIONS_BY_TYPE: Record<string, AiActionKey[]> = {
  call: ['ai', 'summarize', 'replay', 'transcription', 'actionItems'],
  email: ['ai', 'summarize', 'showEmail', 'reply', 'sentiment'],
  meeting: ['ai', 'summarize', 'notes', 'attendees'],
  note: ['ai', 'summarize'],
}

/** Per-activity-type action keys in timeline (inline) layout. */
export const AI_TIMELINE_ACTIONS_BY_TYPE: Record<string, AiActionKey[]> = {
  call: ['summarize', 'replay', 'transcription', 'actionItems'],
  email: ['summarize', 'showEmail', 'reply', 'sentiment'],
  meeting: ['summarize', 'replay', 'actionItems', 'leadScore'],
  note: ['expand', 'bulletize', 'translate'],
}

export function resolveAiActions(
  activityType: string,
  table: Record<string, AiActionKey[]>,
): AiActionDefinition[] {
  const fallbackKeys = table.note ?? []
  const keys = table[activityType] ?? fallbackKeys
  return keys.map((key) => AI_ACTION_DEFINITIONS[key]).filter(Boolean)
}
