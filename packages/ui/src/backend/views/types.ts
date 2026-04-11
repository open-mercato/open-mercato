export type SidebarMode =
  | { type: 'idle' }
  | { type: 'new' }
  | { type: 'share'; perspectiveId: string; perspectiveName: string; perspectiveIsDefault: boolean }

export const perspectivesCheckboxClassName =
  'size-[18px] shrink-0 appearance-none rounded-[3px] border border-border bg-background checked:bg-brand-violet checked:border-brand-violet relative checked:after:content-["✓"] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-brand-violet-foreground checked:after:text-[10px] checked:after:font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition-colors'
