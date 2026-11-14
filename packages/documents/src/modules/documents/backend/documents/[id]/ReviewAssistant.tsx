"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { ChevronDown, ChevronUp, PanelBottom, PanelRight } from 'lucide-react'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeFindingList, type DocumentFindingItem } from './findingModel'
import {
  buildReviewAssistantPageContext,
  readReviewAssistantPlacement,
  resolveReviewAssistantConversationId,
  writeReviewAssistantPlacement,
  type ReviewAssistantPlacement,
  type SettledAssistantAction,
} from './reviewAssistantModel'

const DOCK_HEIGHT = '40vh'

function readDocumentLocale(): string | null {
  if (typeof document === 'undefined') return null
  return document.documentElement.lang || null
}

export const handledAssistantActions = new Set<string>()

const ReviewAssistantChat = dynamic(() => import('./ReviewAssistantChat'), { ssr: false })

type ComposerPrefill = { text: string; requestId: number }

type ReviewAssistantContextValue = {
  enabled: boolean
  activated: boolean
  placement: ReviewAssistantPlacement
  setPlacement: (placement: ReviewAssistantPlacement) => void
  dockCollapsed: boolean
  setDockCollapsed: (collapsed: boolean) => void
  openRequestId: number
  activeFindingId: string | null
  chatNode: HTMLDivElement | null
  activate: () => void
  ask: (finding?: Pick<DocumentFindingItem, 'id' | 'title'>) => void
  registerFindingsReload: (reload: (() => Promise<void>) | null) => void
  settle: (action: SettledAssistantAction) => void
}

const ReviewAssistantContext = React.createContext<ReviewAssistantContextValue | null>(null)

export function useReviewAssistant(): ReviewAssistantContextValue | null {
  return React.useContext(ReviewAssistantContext)
}

function findingsListUrl(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/findings?page=1&pageSize=100`
}

export function PlacementToggle() {
  const t = useT()
  const assistant = useReviewAssistant()
  if (!assistant) return null
  const toDock = assistant.placement === 'rail'
  const label = t(toDock ? 'documents.reviewAssistant.placement.toDock' : 'documents.reviewAssistant.placement.toRail')
  return (
    <SimpleTooltip content={label} size="sm">
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        aria-label={label}
        data-testid="documents-review-assistant-placement-toggle"
        data-placement={assistant.placement}
        onClick={() => assistant.setPlacement(toDock ? 'dock' : 'rail')}
      >
        {toDock ? <PanelBottom /> : <PanelRight />}
      </IconButton>
    </SimpleTooltip>
  )
}

type ReviewAssistantProviderProps = {
  documentId: string
  editor: Editor | null
  enabled: boolean
  children: React.ReactNode
}

export function ReviewAssistantProvider({ documentId, editor, enabled, children }: ReviewAssistantProviderProps) {
  const t = useT()
  const [placement, setPlacementState] = React.useState<ReviewAssistantPlacement>('rail')
  const [dockCollapsed, setDockCollapsed] = React.useState(true)
  const [activated, setActivated] = React.useState(false)
  const [openRequestId, setOpenRequestId] = React.useState(0)
  const [activeFindingId, setActiveFindingId] = React.useState<string | null>(null)
  const [prefill, setPrefill] = React.useState<ComposerPrefill | null>(null)
  const [chatNode] = React.useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null
    const node = document.createElement('div')
    node.className = 'flex h-full min-h-0 flex-col'
    node.setAttribute('data-testid', 'documents-review-assistant-chat')
    return node
  })
  const conversationId = React.useMemo(() => resolveReviewAssistantConversationId(documentId), [documentId])
  const findingsReload = React.useRef<(() => Promise<void>) | null>(null)
  const editorRef = React.useRef(editor)
  editorRef.current = editor

  React.useEffect(() => {
    setPlacementState(readReviewAssistantPlacement())
  }, [])

  const setPlacement = React.useCallback((next: ReviewAssistantPlacement) => {
    setPlacementState(next)
    writeReviewAssistantPlacement(next)
    if (next === 'dock') setDockCollapsed(false)
    setOpenRequestId((current) => current + 1)
  }, [])

  const activate = React.useCallback(() => setActivated(true), [])

  const ask = React.useCallback((finding?: Pick<DocumentFindingItem, 'id' | 'title'>) => {
    setActivated(true)
    setDockCollapsed(false)
    setOpenRequestId((current) => current + 1)
    if (!finding) return
    setActiveFindingId(finding.id)
    setPrefill((current) => ({
      text: t('documents.reviewAssistant.askQuestion', { title: finding.title }),
      requestId: (current?.requestId ?? 0) + 1,
    }))
  }, [t])

  const registerFindingsReload = React.useCallback((reload: (() => Promise<void>) | null) => {
    findingsReload.current = reload
  }, [])

  const replaceAppliedText = React.useCallback(async (findingId: string): Promise<boolean> => {
    const call = await apiCall<unknown>(findingsListUrl(documentId))
    if (!call.ok) return false
    const finding = normalizeFindingList(call.result).find((candidate) => candidate.id === findingId)
    if (!finding || finding.status !== 'applied' || finding.appliedText === null) return false
    const decorations = await import('./findingDecorations')
    const currentEditor = editorRef.current
    const resolution = decorations.resolveFindingsInEditor(currentEditor, [finding]).resolutions[finding.id]
    if (resolution?.kind !== 'located' || !resolution.matches) return false
    return decorations.replaceFindingText(currentEditor, resolution, finding.appliedText)
  }, [documentId])

  const settle = React.useCallback((action: SettledAssistantAction) => {
    if (handledAssistantActions.has(action.pendingActionId)) return
    handledAssistantActions.add(action.pendingActionId)
    void (async () => {
      if (action.decision === 'apply') {
        const replaced = await replaceAppliedText(action.findingId).catch(() => false)
        flash(
          t(replaced ? 'documents.findings.flash.applied' : 'documents.reviewAssistant.error.applyText'),
          replaced ? 'success' : 'error',
        )
      } else {
        flash(t(action.decision === 'keep' ? 'documents.findings.flash.kept' : 'documents.findings.flash.reopened'), 'success')
      }
      await findingsReload.current?.()
    })()
  }, [replaceAppliedText, t])

  const pageContext = React.useMemo(
    () => buildReviewAssistantPageContext({ documentId, activeFindingId, locale: readDocumentLocale() }),
    [activeFindingId, documentId],
  )

  const value = React.useMemo<ReviewAssistantContextValue>(() => ({
    enabled,
    activated,
    placement,
    setPlacement,
    dockCollapsed,
    setDockCollapsed,
    openRequestId,
    activeFindingId,
    chatNode,
    activate,
    ask,
    registerFindingsReload,
    settle,
  }), [activate, activated, activeFindingId, ask, chatNode, dockCollapsed, enabled, openRequestId, placement, registerFindingsReload, setPlacement, settle])

  return (
    <ReviewAssistantContext.Provider value={value}>
      {children}
      {enabled && activated && chatNode
        ? createPortal(
          <ReviewAssistantChat
            conversationId={conversationId}
            pageContext={pageContext}
            composerPrefill={prefill}
          />,
          chatNode,
        )
        : null}
    </ReviewAssistantContext.Provider>
  )
}

/**
 * Mount point for the single chat instance. The chat DOM node is moved into
 * whichever slot is mounted, so switching placement keeps the conversation,
 * the composer draft and any in-flight answer.
 */
export function ReviewAssistantSlot({ className }: { className?: string }) {
  const assistant = useReviewAssistant()
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const chatNode = assistant?.chatNode ?? null
  const activate = assistant?.activate
  React.useLayoutEffect(() => {
    activate?.()
    const host = hostRef.current
    if (!host || !chatNode) return
    host.appendChild(chatNode)
    return () => {
      if (chatNode.parentNode === host) host.removeChild(chatNode)
    }
  }, [activate, chatNode])
  return <div ref={hostRef} className={className} data-testid="documents-review-assistant-slot" />
}

export function ReviewAssistantDock() {
  const t = useT()
  const assistant = useReviewAssistant()
  if (!assistant?.enabled || assistant.placement !== 'dock') return null
  const collapsed = assistant.dockCollapsed
  const toggleLabel = t(collapsed ? 'documents.reviewAssistant.dock.expand' : 'documents.reviewAssistant.dock.collapse')
  return (
    <section
      className="sticky bottom-0 z-20 mt-4 rounded-lg border border-border bg-background shadow-lg"
      aria-label={t('documents.reviewAssistant.title')}
      data-testid="documents-review-assistant-dock"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AiIcon className="size-4" aria-hidden />
          {t('documents.reviewAssistant.title')}
        </span>
        <div className="flex items-center gap-1">
          {collapsed ? <PlacementToggle /> : null}
          <SimpleTooltip content={toggleLabel} size="sm">
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              data-testid="documents-review-assistant-dock-collapse"
              onClick={() => assistant.setDockCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronUp /> : <ChevronDown />}
            </IconButton>
          </SimpleTooltip>
        </div>
      </div>
      <div hidden={collapsed} className="p-2" style={{ height: DOCK_HEIGHT }}>
        {collapsed && !assistant.activated ? null : <ReviewAssistantSlot className="h-full" />}
      </div>
    </section>
  )
}
