import React, { memo } from 'react';
import { useCellStore, useSelection } from '../hooks/index';
import { ColumnDef, SortState } from '../types/index';

export interface ColumnHeadersProps {
  columns: ColumnDef[];
  rowHeaders: boolean;
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
  totalWidth: number;
  sortState: SortState;
  actionsColumnWidth: number;
  showActionsColumn?: boolean;
  onSort: (colIndex: number) => void;
  onResizeStart: (e: React.MouseEvent, colIndex: number) => void;
  onDoubleClick: (e: React.MouseEvent, colIndex: number) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
}

const ColumnHeaders: React.FC<ColumnHeadersProps> = memo(
  ({
    columns,
    rowHeaders,
    leftOffsets,
    rightOffsets,
    totalWidth,
    sortState,
    actionsColumnWidth,
    showActionsColumn = true,
    onSort,
    onResizeStart,
    onDoubleClick,
    onMouseDown,
    onMouseMove,
  }) => {
    const store = useCellStore();
    const selection = useSelection();

    return (
      <div
        className="hot-headers-sticky"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
      >
        <table className="hot-table" style={{ width: `${totalWidth}px` }}>
          <thead>
            <tr style={{ display: 'flex' }}>
              {rowHeaders && (
                <th
                  className="hot-row-header"
                  style={{
                    width: 50,
                    flexBasis: 50,
                    flexShrink: 0,
                    flexGrow: 0,
                    position: 'sticky',
                    left: 0,
                    zIndex: 4,
                  }}
                />
              )}

              {columns.map((col, colIndex) => {
                const isInColRange =
                  selection.type === 'colRange' &&
                  selection.anchor &&
                  selection.focus &&
                  colIndex >= Math.min(selection.anchor.col, selection.focus.col) &&
                  colIndex <= Math.max(selection.anchor.col, selection.focus.col);

                const colWidth = store.getColumnWidth(colIndex);

                const headerStyle: React.CSSProperties = {
                  width: colWidth,
                  flexBasis: colWidth,
                  flexShrink: 0,
                  flexGrow: 0,
                  position: 'relative',
                };

                if (leftOffsets[colIndex] !== undefined) {
                  headerStyle.position = 'sticky';
                  headerStyle.left = leftOffsets[colIndex];
                  headerStyle.zIndex = 3;
                } else if (rightOffsets[colIndex] !== undefined) {
                  headerStyle.position = 'sticky';
                  headerStyle.right = rightOffsets[colIndex];
                  headerStyle.zIndex = 3;
                }

                return (
                  <th
                    key={col.data}
                    className="hot-col-header"
                    onDoubleClick={(e) => onDoubleClick(e, colIndex)}
                    style={headerStyle}
                    data-col={colIndex}
                    data-in-col-range={isInColRange}
                    data-sticky-left={leftOffsets[colIndex] !== undefined}
                    data-sticky-right={rightOffsets[colIndex] !== undefined}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        minWidth: 0,
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                          flex: 1,
                        }}
                        title={col.title || col.data}
                      >
                        {col.title || col.data}
                      </span>
                      <button
                        className="hot-col-sort-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSort(colIndex);
                        }}
                        title={
                          sortState.columnIndex === colIndex && sortState.direction
                            ? `Sorted ${sortState.direction === 'asc' ? 'ascending' : 'descending'}`
                            : 'Click to sort'
                        }
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: '2px 4px',
                          display: 'flex',
                          alignItems: 'center',
                          fontSize: '12px',
                          color: sortState.columnIndex === colIndex ? '#3b82f6' : '#9ca3af',
                          transition: 'color 0.2s',
                        }}
                      >
                        {sortState.columnIndex === colIndex && sortState.direction === 'asc' && '↑'}
                        {sortState.columnIndex === colIndex && sortState.direction === 'desc' && '↓'}
                        {(sortState.columnIndex !== colIndex || sortState.direction === null) && '⇅'}
                      </button>
                    </div>
                    <div
                      className="hot-col-resize-handle"
                      onMouseDown={(e) => onResizeStart(e, colIndex)}
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: '5px',
                        cursor: 'col-resize',
                        zIndex: 10,
                      }}
                    />
                  </th>
                );
              })}

              {/* Actions header */}
              {showActionsColumn && (
                <th
                  className="hot-col-header"
                  style={{
                    width: actionsColumnWidth,
                    flexBasis: actionsColumnWidth,
                    flexShrink: 0,
                    flexGrow: 0,
                    position: 'sticky',
                    right: 0,
                    zIndex: 3,
                  }}
                >
                  Actions
                </th>
              )}
            </tr>
          </thead>
        </table>
      </div>
    );
  }
);

ColumnHeaders.displayName = 'ColumnHeaders';

export default ColumnHeaders;
