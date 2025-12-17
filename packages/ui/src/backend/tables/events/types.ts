export interface CellEditSaveEvent {
  rowIndex: number;
  colIndex: number;
  value: string;
  id: string;
}

export interface CellSaveStartEvent {
  rowIndex: number;
  colIndex: number;
}

export interface CellSaveSuccessEvent {
  rowIndex: number;
  colIndex: number;
}

export interface CellSaveErrorEvent {
  rowIndex: number;
  colIndex: number;
  error?: string;
}


// Event names constants
export const TableEvents = {
  CELL_EDIT_SAVE: 'table:cell:edit:save',
  CELL_SAVE_START: 'table:cell:save:start',
  CELL_SAVE_SUCCESS: 'table:cell:save:success',
  CELL_SAVE_ERROR: 'table:cell:save:error',
} as const;