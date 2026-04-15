export type SidebarMode =
  | { type: 'idle' }
  | { type: 'new' }
  | { type: 'share'; perspectiveId: string; perspectiveName: string; perspectiveIsDefault: boolean }
