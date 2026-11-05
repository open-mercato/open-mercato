export type NotesSettings = {
  text: string
}

export const DEFAULT_SETTINGS: NotesSettings = {
  text: '',
}

export function hydrateNotesSettings(raw: unknown): NotesSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const data = raw as Partial<NotesSettings>
  return {
    text: typeof data.text === 'string' ? data.text : '',
  }
}
