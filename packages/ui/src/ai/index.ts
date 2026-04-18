export { AiChat, type AiChatProps, type AiChatDebugTool, type AiChatDebugPromptSection } from './AiChat'
export { useAiChat, type AiChatMessage, type UseAiChatInput, type UseAiChatResult } from './useAiChat'
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
  uploadAttachmentsForChat,
  type UploadAttachmentsForChatOptions,
  type UploadAttachmentsForChatResult,
  type UploadedAttachment,
  type UploadFailure,
  type UploadFailureReason,
} from './upload-adapter'
export {
  useAiChatUpload,
  type UseAiChatUploadOptions,
  type UseAiChatUploadState,
  type AiChatUploadFileState,
  type AiChatUploadFileStatus,
} from './useAiChatUpload'
