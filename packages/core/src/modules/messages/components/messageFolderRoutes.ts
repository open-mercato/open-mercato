import type { MessageFolder } from './useMessagesInboxBulkActions'

const MESSAGE_LIST_FOLDERS: readonly MessageFolder[] = ['inbox', 'sent', 'drafts', 'scheduled', 'archived', 'all']
const MESSAGES_BASE_PATH = '/backend/messages'

export function parseMessageFolder(value: string | null | undefined): MessageFolder {
  return MESSAGE_LIST_FOLDERS.find((folder) => folder === value) ?? 'inbox'
}

function withFolder(path: string, folder: MessageFolder): string {
  return folder === 'inbox' ? path : `${path}?folder=${folder}`
}

export function messageListHref(folder: MessageFolder): string {
  return withFolder(MESSAGES_BASE_PATH, folder)
}

export function messageDetailHref(messageId: string, folder: MessageFolder): string {
  return withFolder(`${MESSAGES_BASE_PATH}/${encodeURIComponent(messageId)}`, folder)
}
