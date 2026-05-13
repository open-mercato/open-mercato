export { AiChat, type AiChatProps, type AiChatDebugTool, type AiChatDebugPromptSection } from './AiChat'
export {
  AiAssistantLauncher,
  AI_ASSISTANT_LAUNCHER_OPEN_EVENT,
  type AiAssistantLauncherAgent,
  type AiAssistantLauncherProps,
} from './AiAssistantLauncher'
export {
  AiDockProvider,
  useAiDock,
  type AiDockedAssistant,
} from './AiDock'
export {
  AiChatSessionsProvider,
  useAiChatSessions,
  defaultSessionLabel,
  type AiChatSession,
} from './AiChatSessions'
export { ChatPaneTabs } from './ChatPaneTabs'
export {
  useAiChat,
  type AiChatMessage,
  type AiChatToolCallSnapshot,
  type AiChatMessageFile,
  type AiChatErrorEnvelope,
  type UseAiChatInput,
  type UseAiChatResult,
} from './useAiChat'
export {
  useAiShortcuts,
  type UseAiShortcutsOptions,
  type UseAiShortcutsResult,
} from './useAiShortcuts'
export {
  registerAiUiPart,
  resolveAiUiPart,
  unregisterAiUiPart,
  resetAiUiPartRegistryForTests,
  listAiUiParts,
  createAiUiPartRegistry,
  defaultAiUiPartRegistry,
  RESERVED_AI_UI_PART_IDS,
  isReservedAiUiPartId,
  type AiUiPartComponent,
  type AiUiPartComponentId,
  type AiUiPartProps,
  type AiUiPartRegistry,
  type AiUiPartRegistryEntry,
  type CreateAiUiPartRegistryOptions,
  type ReservedAiUiPartId,
} from './ui-part-registry'
export { PendingPhase3Placeholder } from './ui-parts/pending-phase3-placeholder'
export {
  MutationPreviewCard,
  FieldDiffCard,
  ConfirmationCard,
  MutationResultCard,
  AI_MUTATION_APPROVAL_CARDS,
  useAiPendingActionPolling,
  confirmPendingAction,
  cancelPendingAction,
  type UseAiPendingActionPollingOptions,
  type UseAiPendingActionPollingResult,
  type PendingActionMutationOk,
  type PendingActionMutationError,
  type PendingActionMutationResult,
  type AiPendingActionCardAction,
  type AiPendingActionCardStatus,
  type AiPendingActionCardFieldDiff,
  type AiPendingActionCardRecordDiff,
  type AiPendingActionCardFailedRecord,
  type AiPendingActionCardExecutionResult,
} from './parts'
export {
  uploadAttachmentsForChat,
  type UploadAttachmentsForChatOptions,
  type UploadAttachmentsForChatResult,
  type UploadedAttachment,
  type UploadFailure,
  type UploadFailureReason,
} from './upload-adapter'
export {
  RecordCard,
  DealCard,
  PersonCard,
  CompanyCard,
  ProductCard,
  ActivityCard,
  RecordCardShell,
  KeyValueList,
  TagRow,
  statusToTagVariant,
  type RecordCardProps,
  type RecordCardShellProps,
  type KeyValueListItem,
  type DealCardProps,
  type PersonCardProps,
  type CompanyCardProps,
  type ProductCardProps,
  type ActivityCardProps,
  type RecordCardKind,
  type RecordCardPayload,
  type RecordCardBaseProps,
  type DealRecordPayload,
  type PersonRecordPayload,
  type CompanyRecordPayload,
  type ProductRecordPayload,
  type ActivityRecordPayload,
  registerRecordCardUiParts,
  RECORD_CARD_COMPONENT_IDS,
  type RecordCardComponentId,
} from './records'
export {
  AiMessageContent,
  parseAiContentSegments,
  RECORD_CARD_FENCE_INFO_PREFIX,
  type AiMessageContentSegment,
  type AiMessageContentProps,
} from './AiMessageContent'
export {
  useAiChatUpload,
  type UseAiChatUploadOptions,
  type UseAiChatUploadState,
  type AiChatUploadFileState,
  type AiChatUploadFileStatus,
} from './useAiChatUpload'
