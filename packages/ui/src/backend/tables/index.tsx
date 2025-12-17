import React, { useState, memo, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import './HOT.css';

// Memoized TableCell component
const TableCell = memo(({ 
  value, 
  rowIndex, 
  colIndex, 
  col, 
  isRowHeader,
  isCellSelected,
  isRowSelected,
  isColSelected,
  hasCellSelected,
  isInRange,
  rangeEdges,
  isInRowRange,
  rowRangeEdges,
  isInColRange,
  colRangeEdges,
  isEditing,
  editValue,
  onEditChange,
  onEditKeyDown,
  onEditBlur,
  editInputRef
}) => {
  if (isRowHeader) {
    return (
      <td 
        className="hot-row-header" 
        data-row={rowIndex}
        data-row-header="true"
        data-has-selected-cell={hasCellSelected}
        data-in-row-range={isInRowRange}
        style={{
          width: 50,
          flexBasis: 50,
          flexShrink: 0,
          flexGrow: 0
        }}
      >
        {rowIndex + 1}
      </td>
    );
  }

  return (
    <td
      className={`hot-cell ${col.readOnly ? 'read-only' : ''}`}
      style={{ 
        width: col.width || 100,
        flexBasis: col.width || 100,
        flexShrink: 0,
        flexGrow: 0,
        position: 'relative'
      }}
      data-row={rowIndex}
      data-col={colIndex}
      data-cell-selected={isCellSelected}
      data-col-selected={isColSelected}
      data-in-range={isInRange}
      data-range-top={rangeEdges.top}
      data-range-bottom={rangeEdges.bottom}
      data-range-left={rangeEdges.left}
      data-range-right={rangeEdges.right}
      data-in-row-range={isInRowRange}
      data-row-range-top={rowRangeEdges.top}
      data-row-range-bottom={rowRangeEdges.bottom}
      data-in-col-range={isInColRange}
      data-col-range-left={colRangeEdges.left}
      data-col-range-right={colRangeEdges.right}
    >
      {isEditing ? (
        <textarea
          ref={editInputRef}
          value={editValue}
          onChange={onEditChange}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className="hot-cell-editor"
        />
      ) : (
        value
      )}
    </td>
  );
});

TableCell.displayName = 'TableCell';

const HOT = ({ 
  data = [], 
  columns = [],
  colHeaders = true,
  rowHeaders = false,
  height = 'auto',
  width = 'auto'
}) => {
  const [tableData, setTableData] = useState(data);
  const [selection, setSelection] = useState({
    type: null,
    row: null,
    col: null,
    range: null,
    rowRange: null,
    colRange: null
  });
  const [editing, setEditing] = useState({ row: null, col: null, value: '' });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);
  const dragTypeRef = useRef(null);
  const lastUpdateRef = useRef(0);
  const editInputRef = useRef(null);
  const parentRef = useRef(null);
  const THROTTLE_MS = 50;

  const isObjectData = tableData.length > 0 && typeof tableData[0] === 'object' && !Array.isArray(tableData[0]);

  const getColumns = () => {
    if (columns.length > 0) return columns;
    if (isObjectData && tableData.length > 0) {
      return Object.keys(tableData[0]).map(key => ({ data: key }));
    }
    if (tableData.length > 0 && Array.isArray(tableData[0])) {
      return tableData[0].map((_, index) => ({ data: index }));
    }
    return [];
  };

  const cols = getColumns();

  const getCellValue = useCallback((row, col) => {
    if (isObjectData) {
      return row[col.data];
    }
    return row[col.data];
  }, [isObjectData]);

  const getColHeader = (col, index) => {
    if (Array.isArray(colHeaders)) return colHeaders[index];
    if (col.title) return col.title;
    if (isObjectData) return col.data;
    return String.fromCharCode(65 + index);
  };

  const isInRange = useCallback((r, c) => {
    if (!selection.range) return false;
    const { startRow, endRow, startCol, endCol } = selection.range;
    return r >= startRow && r <= endRow && c >= startCol && c <= endCol;
  }, [selection.range]);

  const getRangeEdges = useCallback((r, c) => {
    if (!selection.range) return {};
    const { startRow, endRow, startCol, endCol } = selection.range;
    return {
      top: r === startRow,
      bottom: r === endRow,
      left: c === startCol,
      right: c === endCol
    };
  }, [selection.range]);

  const isInRowRange = useCallback((r) => {
    if (!selection.rowRange) return false;
    const { start, end } = selection.rowRange;
    return r >= start && r <= end;
  }, [selection.rowRange]);

  const getRowRangeEdges = useCallback((r) => {
    if (!selection.rowRange) return {};
    const { start, end } = selection.rowRange;
    return {
      top: r === start,
      bottom: r === end
    };
  }, [selection.rowRange]);

  const isInColRange = useCallback((c) => {
    if (!selection.colRange) return false;
    const { start, end } = selection.colRange;
    return c >= start && c <= end;
  }, [selection.colRange]);

  const getColRangeEdges = useCallback((c) => {
    if (!selection.colRange) return {};
    const { start, end } = selection.colRange;
    return {
      left: c === start,
      right: c === end
    };
  }, [selection.colRange]);

  const handleEditSave = useCallback(() => {
    if (editing.row === null || editing.col === null) return;
    
    const newData = [...tableData];
    if (isObjectData) {
      newData[editing.row] = { ...newData[editing.row], [cols[editing.col].data]: editing.value };
    } else {
      newData[editing.row] = [...newData[editing.row]];
      newData[editing.row][cols[editing.col].data] = editing.value;
    }
    
    setTableData(newData);
    setEditing({ row: null, col: null, value: '' });
  }, [editing, tableData, cols, isObjectData]);

  const handleMouseDown = useCallback((e) => {
    // Save any ongoing edit before changing selection
    if (editing.row !== null) {
      handleEditSave();
    }
    
    const cell = e.target.closest('td');
    if (!cell) return;
    
    const isRowHeader = cell.getAttribute('data-row-header') === 'true';
    const row = parseInt(cell.getAttribute('data-row'), 10);
    
    if (isRowHeader) {
      dragStartRef.current = row;
      dragTypeRef.current = 'row';
      setIsDragging(true);
      setSelection({ 
        type: 'rowRange', 
        row: null, 
        col: null, 
        range: null, 
        rowRange: { start: row, end: row },
        colRange: null 
      });
      e.preventDefault();
      return;
    }
  
    const col = parseInt(cell.getAttribute('data-col'), 10);
    
    dragStartRef.current = { row, col };
    dragTypeRef.current = 'cell';
    setIsDragging(true);
    setSelection({ 
      type: 'range', 
      row: null, 
      col: null, 
      range: { startRow: row, endRow: row, startCol: col, endCol: col },
      rowRange: null,
      colRange: null
    });
    
    e.preventDefault();
  }, [editing.row, handleEditSave]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || dragStartRef.current == null || !dragTypeRef.current) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < THROTTLE_MS) return;
    lastUpdateRef.current = now;

    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('td');
    if (!cell) return;

    if (dragTypeRef.current === 'row') {
      const row = parseInt(cell.getAttribute('data-row'), 10);
      if (isNaN(row)) return;

      const startRow = dragStartRef.current;
      setSelection(prev => ({
        ...prev,
        rowRange: {
          start: Math.min(startRow, row),
          end: Math.max(startRow, row)
        }
      }));
    } else if (dragTypeRef.current === 'cell') {
      if (cell.getAttribute('data-row-header') === 'true') return;
      
      const row = parseInt(cell.getAttribute('data-row'), 10);
      const col = parseInt(cell.getAttribute('data-col'), 10);
      
      if (isNaN(row) || isNaN(col)) return;

      const { row: startRow, col: startCol } = dragStartRef.current;
      
      setSelection(prev => ({
        ...prev,
        range: {
          startRow: Math.min(startRow, row),
          endRow: Math.max(startRow, row),
          startCol: Math.min(startCol, col),
          endCol: Math.max(startCol, col)
        }
      }));
    }
  }, [isDragging, THROTTLE_MS]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      dragStartRef.current = null;
    }
  }, [isDragging]);

  const handleColHeaderMouseDown = useCallback((e) => {
    const header = e.target.closest('th');
    if (!header || header.classList.contains('hot-row-header')) return;

    const col = parseInt(header.getAttribute('data-col'), 10);
    if (isNaN(col)) return;

    dragStartRef.current = col;
    dragTypeRef.current = 'column';
    setIsDragging(true);
    setSelection({ 
      type: 'colRange', 
      row: null, 
      col: null, 
      range: null,
      rowRange: null,
      colRange: { start: col, end: col }
    });
    
    e.preventDefault();
  }, []);

  

  const handleColHeaderMouseMove = useCallback((e) => {
    if (!isDragging || dragStartRef.current == null || dragTypeRef.current !== 'column') return;

    const now = Date.now();
    if (now - lastUpdateRef.current < THROTTLE_MS) return;
    lastUpdateRef.current = now;

    const header = document.elementFromPoint(e.clientX, e.clientY)?.closest('th');
    if (!header || header.classList.contains('hot-row-header')) return;

    const col = parseInt(header.getAttribute('data-col'), 10);
    if (isNaN(col)) return;

    const startCol = dragStartRef.current;
    setSelection(prev => ({
      ...prev,
      colRange: {
        start: Math.min(startCol, col),
        end: Math.max(startCol, col)
      }
    }));
  }, [isDragging, THROTTLE_MS]);

  const handleDoubleClick = useCallback((e) => {
    const cell = e.target.closest('td');
    if (!cell || cell.getAttribute('data-row-header') === 'true') return;
    
    const row = parseInt(cell.getAttribute('data-row'), 10);
    const col = parseInt(cell.getAttribute('data-col'), 10);
    
    if (isNaN(row) || isNaN(col)) return;
    
    // Update selection to the cell being edited
    setSelection({
      type: 'range',
      row: null,
      col: null,
      range: { startRow: row, endRow: row, startCol: col, endCol: col },
      rowRange: null,
      colRange: null
    });
    
    const currentValue = getCellValue(tableData[row], cols[col]);
    setEditing({ row, col, value: String(currentValue ?? '') });
  }, [tableData, cols, getCellValue]);


  const handleEditCancel = useCallback(() => {
    setEditing({ row: null, col: null, value: '' });
  }, []);

  const handleEditKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const editedRow = editing.row;
      const editedCol = editing.col;
      
      // Save current edit
      const newData = [...tableData];
      if (isObjectData) {
        newData[editedRow] = { ...newData[editedRow], [cols[editedCol].data]: editing.value };
      } else {
        newData[editedRow] = [...newData[editedRow]];
        newData[editedRow][cols[editedCol].data] = editing.value;
      }
      setTableData(newData);
      
      // Move to next row, same column
      const nextRow = editedRow + 1;
      if (nextRow < tableData.length) {
        const nextValue = getCellValue(newData[nextRow], cols[editedCol]);
        setSelection({
          type: 'range',
          row: null,
          col: null,
          range: { startRow: nextRow, endRow: nextRow, startCol: editedCol, endCol: editedCol },
          rowRange: null,
          colRange: null
        });
        setEditing({ row: nextRow, col: editedCol, value: String(nextValue ?? '') });
      } else {
        // Last row - just close editing
        setEditing({ row: null, col: null, value: '' });
        setSelection({
          type: 'range',
          row: null,
          col: null,
          range: { startRow: editedRow, endRow: editedRow, startCol: editedCol, endCol: editedCol },
          rowRange: null,
          colRange: null
        });
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    }
  }, [editing, tableData, cols, isObjectData, getCellValue, handleEditCancel]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isDragging, handleMouseUp]);

  useEffect(() => {
    if (editing.row !== null && editInputRef.current) {
      editInputRef.current.focus();
      const length = editInputRef.current.value.length;
      editInputRef.current.setSelectionRange(length, length);
    }
  }, [editing.row]);

  useEffect(() => {
    const handleCopy = (e) => {
      if (!selection.type) return;

      let textData = '';

      if (selection.type === 'cell') {
        const row = tableData[selection.row];
        const col = cols[selection.col];
        textData = String(getCellValue(row, col) ?? '');
      } 
      else if (selection.type === 'range' && selection.range) {
        const { startRow, endRow, startCol, endCol } = selection.range;
        const rows = [];
        for (let r = startRow; r <= endRow; r++) {
          const row = tableData[r];
          const cells = [];
          for (let c = startCol; c <= endCol; c++) {
            const col = cols[c];
            cells.push(String(getCellValue(row, col) ?? ''));
          }
          rows.push(cells.join('\t'));
        }
        textData = rows.join('\n');
      }
      else if (selection.type === 'rowRange' && selection.rowRange) {
        const { start, end } = selection.rowRange;
        const rows = [];
        for (let r = start; r <= end; r++) {
          const row = tableData[r];
          const cells = cols.map(col => String(getCellValue(row, col) ?? ''));
          rows.push(cells.join('\t'));
        }
        textData = rows.join('\n');
      }
      else if (selection.type === 'colRange' && selection.colRange) {
        const { start, end } = selection.colRange;
        const rows = [];
        for (let r = 0; r < tableData.length; r++) {
          const row = tableData[r];
          const cells = [];
          for (let c = start; c <= end; c++) {
            const col = cols[c];
            cells.push(String(getCellValue(row, col) ?? ''));
          }
          rows.push(cells.join('\t'));
        }
        textData = rows.join('\n');
      }

      if (textData) {
        e.clipboardData.setData('text/plain', textData);
        e.preventDefault();
      }
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [selection, tableData, cols, getCellValue]);

  // Handle keyboard navigation
// Handle keyboard navigation
useEffect(() => {
    const handleKeyDown = (e) => {
      // Tab navigation
      if (e.key === 'Tab') {
        e.preventDefault();
        
        // If editing, save first
        if (editing.row !== null) {
          handleEditSave();
          
          // Calculate next cell from editing position
          const direction = e.shiftKey ? -1 : 1;
          let nextCol = editing.col + direction;
          let nextRow = editing.row;
          
          // Handle column overflow
          if (nextCol >= cols.length) {
            nextCol = 0;
            nextRow++;
          } else if (nextCol < 0) {
            nextCol = cols.length - 1;
            nextRow--;
          }
          
          // Check bounds
          if (nextRow >= 0 && nextRow < tableData.length) {
            setSelection({
              type: 'range',
              row: null,
              col: null,
              range: { startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol },
              rowRange: null,
              colRange: null
            });
          }
          return;
        }
        
        // Determine current cell
        let currentRow, currentCol;
        if (selection.type === 'range' && selection.range) {
          const { startRow, startCol, endRow, endCol } = selection.range;
          if (startRow === endRow && startCol === endCol) {
            currentRow = startRow;
            currentCol = startCol;
          } else {
            return;
          }
        } else {
          return;
        }
        
        // Calculate next cell
        const direction = e.shiftKey ? -1 : 1;
        let nextCol = currentCol + direction;
        let nextRow = currentRow;
        
        // Handle column overflow
        if (nextCol >= cols.length) {
          nextCol = 0;
          nextRow++;
        } else if (nextCol < 0) {
          nextCol = cols.length - 1;
          nextRow--;
        }
        
        // Check bounds
        if (nextRow >= 0 && nextRow < tableData.length) {
          setSelection({
            type: 'range',
            row: null,
            col: null,
            range: { startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol },
            rowRange: null,
            colRange: null
          });
        }
      }
      
      // Enter to start editing
      if (e.key === 'Enter' && editing.row === null) {
        e.preventDefault();
        if (selection.type === 'range' && selection.range) {
          const { startRow, startCol, endRow, endCol } = selection.range;
          if (startRow === endRow && startCol === endCol) {
            const currentValue = getCellValue(tableData[startRow], cols[startCol]);
            setSelection({
              type: 'cell',
              row: startRow,
              col: startCol,
              range: null,
              rowRange: null,
              colRange: null
            });
            setEditing({ row: startRow, col: startCol, value: String(currentValue ?? '') });
          }
        }
      }
      
      // Arrow navigation (only when not editing)
      // Arrow navigation (only when not editing)
if (editing.row === null && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    
    let currentRow, currentCol;
    
    // Handle both 'range' and 'cell' selection types
    if (selection.type === 'range' && selection.range) {
      const { startRow, startCol, endRow, endCol } = selection.range;
      if (startRow === endRow && startCol === endCol) {
        currentRow = startRow;
        currentCol = startCol;
      } else {
        return;
      }
    } else if (selection.type === 'cell') {
      currentRow = selection.row;
      currentCol = selection.col;
    } else {
      return;
    }
    
    let nextRow = currentRow;
    let nextCol = currentCol;
    
    switch (e.key) {
      case 'ArrowUp':
        nextRow = Math.max(0, currentRow - 1);
        break;
      case 'ArrowDown':
        nextRow = Math.min(tableData.length - 1, currentRow + 1);
        break;
      case 'ArrowLeft':
        nextCol = Math.max(0, currentCol - 1);
        break;
      case 'ArrowRight':
        nextCol = Math.min(cols.length - 1, currentCol + 1);
        break;
    }
    
    setSelection({
      type: 'range',
      row: null,
      col: null,
      range: { startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol },
      rowRange: null,
      colRange: null
    });
  }
    };
  
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selection, editing, tableData, cols, getCellValue, handleEditSave]);

  const rowVirtualizer = useVirtualizer({
    count: tableData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalWidth = cols.reduce((sum, col) => sum + (col.width || 100), 0) + (rowHeaders ? 50 : 0);

  return (
    <div className="hot-container" style={{ height, width }}>
      <div 
        ref={parentRef}
        className="hot-virtual-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onDoubleClick={handleDoubleClick}
        style={{
          height: typeof height === 'string' && height !== 'auto' ? height : '600px',
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {colHeaders && (
          <div 
            className="hot-headers-sticky"
            onMouseDown={handleColHeaderMouseDown}
            onMouseMove={handleColHeaderMouseMove}
          >
            <table className="hot-table">
              <thead>
                <tr>
                  {rowHeaders && <th className="hot-row-header" style={{ width: 50 }}></th>}
                  {cols.map((col, colIndex) => {
                    const isColSelected = selection.type === 'column' && selection.col === colIndex;
                    const hasCellSelected = selection.type === 'cell' && selection.col === colIndex;
                    const inColRange = isInColRange(colIndex);
                    const colEdges = getColRangeEdges(colIndex);
                    return (
                      <th 
                        key={colIndex}
                        className="hot-col-header"
                        style={{ width: col.width || 100 }}
                        data-col={colIndex}
                        data-col-selected={isColSelected}
                        data-has-selected-cell={hasCellSelected}
                        data-in-col-range={inColRange}
                        data-col-range-left={colEdges.left}
                        data-col-range-right={colEdges.right}
                      >
                        {getColHeader(col, colIndex)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
            </table>
          </div>
        )}

        <table className="hot-table" style={{ width: `${totalWidth}px` }}>
          <tbody
            style={{
              display: 'block',
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {virtualRows.map((virtualRow) => {
              const row = tableData[virtualRow.index];
              const rowIndex = virtualRow.index;
              const isRowSelected = selection.type === 'row' && selection.row === rowIndex;
              const hasCellSelected = selection.type === 'cell' && selection.row === rowIndex;
              const rowInRowRange = isInRowRange(rowIndex);
              const rowRangeEdges = getRowRangeEdges(rowIndex);

              return (
                <tr
                  key={virtualRow.index}
                  data-row={rowIndex}
                  data-row-selected={isRowSelected}
                  style={{
                    display: 'flex',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {rowHeaders && (
                    <TableCell 
                      rowIndex={rowIndex}
                      isRowHeader={true}
                      hasCellSelected={hasCellSelected}
                      isInRowRange={rowInRowRange}
                      rowRangeEdges={rowRangeEdges}
                    />
                  )}
                  {cols.map((col, colIndex) => {
                    const isCellSelected = 
                      selection.type === 'cell' && 
                      selection.row === rowIndex && 
                      selection.col === colIndex;
                    const isColSelected = 
                      selection.type === 'column' && 
                      selection.col === colIndex;
                    const cellInRange = isInRange(rowIndex, colIndex);
                    const rangeEdges = getRangeEdges(rowIndex, colIndex);
                    const cellInColRange = isInColRange(colIndex);
                    const colRangeEdges = getColRangeEdges(colIndex);
                    const isEditingThisCell = editing.row === rowIndex && editing.col === colIndex;

                    return (
                      <TableCell
                        key={colIndex}
                        value={getCellValue(row, col)}
                        rowIndex={rowIndex}
                        colIndex={colIndex}
                        col={col}
                        isCellSelected={isCellSelected}
                        isRowSelected={isRowSelected}
                        isColSelected={isColSelected}
                        isInRange={cellInRange}
                        rangeEdges={rangeEdges}
                        isInRowRange={rowInRowRange}
                        rowRangeEdges={rowRangeEdges}
                        isInColRange={cellInColRange}
                        colRangeEdges={colRangeEdges}
                        isEditing={isEditingThisCell}
                        editValue={isEditingThisCell ? editing.value : undefined}
                        onEditChange={isEditingThisCell ? (e) => setEditing(prev => ({ ...prev, value: e.target.value })) : undefined}
                        onEditKeyDown={isEditingThisCell ? handleEditKeyDown : undefined}
                        onEditBlur={isEditingThisCell ? handleEditSave : undefined}
                        editInputRef={isEditingThisCell ? editInputRef : undefined}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default HOT;