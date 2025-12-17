export interface CellChangeEvent {
  rowIndex: number;
  colIndex: number;
  value: string;
  rowData: any;
  id: string
}

export interface CellEditStartEvent {
  rowIndex: number;
  colIndex: number;
  currentValue: string;
}

export interface CellEditSaveEvent {
  rowIndex: number;
  colIndex: number;
  value: string;
  id: string;
}

export interface SelectionChangeEvent {
  type: 'cell' | 'row' | 'column' | 'range' | 'rowRange' | 'colRange';
  row?: number;
  col?: number;
  range?: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  };
}

// Event names constants
export const TableEvents = {
  CELL_CHANGE: 'table:cell:change',
  CELL_EDIT_START: 'table:cell:edit:start',
  CELL_EDIT_SAVE: 'table:cell:edit:save',
  CELL_EDIT_CANCEL: 'table:cell:edit:cancel',
  SELECTION_CHANGE: 'table:selection:change',
  DATA_UPDATED: 'table:data:updated',
} as const;