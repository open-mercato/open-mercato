// index.ts

export { default as DynamicTable } from './DynamicTable';
export { default as TableSkeleton } from './components/TableSkeleton';
export { default as Debugger } from './components/Debugger';

// Perspective components
export { default as PerspectiveToolbar } from './components/PerspectiveToolbar';
export { default as PerspectiveTabs } from './components/PerspectiveTabs';
export { default as ColumnsPopover } from './components/ColumnsPopover';
export { default as FilterPopover } from './components/FilterPopover';
export { default as SortPopover } from './components/SortPopover';

export { createCellStore } from './store/index';
export type { CellStore } from './store/index';
export {
  CellStoreContext,
  useCellStore,
  useCellState,
  useStoreRevision,
  useSelectionRevision,
  useSelection,
  useDragHandling,
  useKeyboardNavigation,
  useCopyHandler,
  useStickyOffsets,
} from './hooks/index';
export * from './types/index';
export * from './validators';
export { dispatch, useMediator, useListener, useEventHandlers } from './events/events';

// Perspective handlers
export {
  createPerspectiveHandlers,
  initializePerspectiveState,
} from './handlers/perspectiveHandlers';
export type { PerspectiveState, PerspectiveHandlersDeps } from './handlers/perspectiveHandlers';

// Entity search editor for connected entities
export {
  EntitySearchEditor,
  createEntitySearchEditor,
} from './components/EntitySearchEditor';
export type {
  EntitySearchEditorConfig,
  SearchResult as EntitySearchResult,
  DynamicTableEditorFn,
} from './components/EntitySearchEditor';
