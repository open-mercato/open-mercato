import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ColumnDef } from '../types/index';

interface ColumnsPopoverProps {
  columns: ColumnDef[];
  visibleColumns: string[];
  hiddenColumns: string[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
  onColumnOrderChange: (newOrder: string[]) => void;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const ColumnsPopover: React.FC<ColumnsPopoverProps> = ({
  columns,
  visibleColumns,
  hiddenColumns,
  onColumnVisibilityChange,
  onColumnOrderChange,
  isOpen,
  onClose,
  anchorRef,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Visible columns first (in their order), then hidden columns
  const allColumnKeys = React.useMemo(() => {
    return [...visibleColumns, ...hiddenColumns];
  }, [visibleColumns, hiddenColumns]);

  // Get column title by key
  const getColumnTitle = (key: string) => {
    const col = columns.find(c => c.data === key);
    return col?.title || key;
  };

  // Get column type icon
  const getColumnIcon = (key: string) => {
    const col = columns.find(c => c.data === key);
    switch (col?.type) {
      case 'numeric': return '#';
      case 'date': return '📅';
      case 'boolean': return '✓';
      case 'dropdown': return '▼';
      default: return 'A';
    }
  };

  // Filter columns by search query
  const filteredColumns = allColumnKeys.filter(key => {
    const title = getColumnTitle(key).toLowerCase();
    return title.includes(searchQuery.toLowerCase());
  });

  // Position popover
  useEffect(() => {
    if (!isOpen || !anchorRef.current || !popoverRef.current) return;

    const anchor = anchorRef.current.getBoundingClientRect();
    const popover = popoverRef.current;

    popover.style.top = `${anchor.bottom + 4}px`;
    popover.style.left = `${anchor.left}px`;
  }, [isOpen, anchorRef]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  // Toggle column visibility - preserve position in the list
  const toggleColumn = useCallback((key: string) => {
    const isVisible = visibleColumns.includes(key);

    if (isVisible) {
      // Hide: remove from visible, add to end of hidden
      const newVisible = visibleColumns.filter(k => k !== key);
      const newHidden = [...hiddenColumns, key];
      onColumnVisibilityChange(newVisible, newHidden);
    } else {
      // Show: remove from hidden, add to end of visible
      const newHidden = hiddenColumns.filter(k => k !== key);
      const newVisible = [...visibleColumns, key];
      onColumnVisibilityChange(newVisible, newHidden);
    }
  }, [visibleColumns, hiddenColumns, onColumnVisibilityChange]);

  // Hide all columns (keep at least first one visible)
  const hideAll = useCallback(() => {
    const firstColumn = visibleColumns[0];
    if (firstColumn) {
      // Keep first visible, move rest to hidden (preserving order)
      const newHidden = [...visibleColumns.slice(1), ...hiddenColumns];
      onColumnVisibilityChange([firstColumn], newHidden);
    }
  }, [visibleColumns, hiddenColumns, onColumnVisibilityChange]);

  // Show all columns (preserve current order)
  const showAll = useCallback(() => {
    // Move all to visible, preserving current order
    const allVisible = [...visibleColumns, ...hiddenColumns];
    onColumnVisibilityChange(allVisible, []);
  }, [visibleColumns, hiddenColumns, onColumnVisibilityChange]);

  // Drag handlers for reordering
  const handleDragStart = (e: React.DragEvent, key: string) => {
    setDraggedItem(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };

  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();

    // Only allow drop within same visibility group
    const draggedIsVisible = draggedItem ? visibleColumns.includes(draggedItem) : false;
    const targetIsVisible = visibleColumns.includes(key);

    if (draggedIsVisible !== targetIsVisible) {
      e.dataTransfer.dropEffect = 'none';
      setDragOverItem(null);
      return;
    }

    e.dataTransfer.dropEffect = 'move';
    if (draggedItem && key !== draggedItem) {
      setDragOverItem(key);
    }
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetKey) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }

    const draggedIsVisible = visibleColumns.includes(draggedItem);
    const targetIsVisible = visibleColumns.includes(targetKey);

    // Only allow reordering within the same visibility group
    if (draggedIsVisible !== targetIsVisible) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }

    if (draggedIsVisible) {
      // Reorder within visible columns
      const newVisible = [...visibleColumns];
      const draggedIndex = newVisible.indexOf(draggedItem);
      const targetIndex = newVisible.indexOf(targetKey);

      newVisible.splice(draggedIndex, 1);
      newVisible.splice(targetIndex, 0, draggedItem);

      onColumnOrderChange(newVisible);
    } else {
      // Reorder within hidden columns
      const newHidden = [...hiddenColumns];
      const draggedIndex = newHidden.indexOf(draggedItem);
      const targetIndex = newHidden.indexOf(targetKey);

      newHidden.splice(draggedIndex, 1);
      newHidden.splice(targetIndex, 0, draggedItem);

      onColumnVisibilityChange(visibleColumns, newHidden);
    }

    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="perspective-popover columns-popover"
      style={{
        position: 'fixed',
        zIndex: 10000,
        background: 'white',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        border: '1px solid #e5e7eb',
        width: 280,
        maxHeight: 400,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Hide fields</span>
          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto' }}>
            {visibleColumns.length} visible
          </span>
        </div>
        <input
          type="text"
          placeholder="Find a field"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 10px',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>

      {/* Column List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {/* Visible columns section */}
        {filteredColumns.filter(k => visibleColumns.includes(k)).map((key) => {
          const isDragging = draggedItem === key;
          const isDragOver = dragOverItem === key;

          return (
            <div
              key={key}
              draggable
              onDragStart={(e) => handleDragStart(e, key)}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, key)}
              onDragEnd={handleDragEnd}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                cursor: 'grab',
                background: isDragOver ? '#f0f9ff' : isDragging ? '#f3f4f6' : 'transparent',
                borderTop: isDragOver ? '2px solid #3b82f6' : '2px solid transparent',
                opacity: isDragging ? 0.5 : 1,
                transition: 'background 0.15s',
              }}
            >
              {/* Visibility Toggle */}
              <button
                onClick={() => toggleColumn(key)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: 'none',
                  background: '#10b981',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  marginRight: 8,
                  flexShrink: 0,
                }}
              >
                ✓
              </button>

              {/* Column Icon */}
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: '#6b7280',
                  marginRight: 8,
                  flexShrink: 0,
                }}
              >
                {getColumnIcon(key)}
              </span>

              {/* Column Name */}
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: '#374151',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getColumnTitle(key)}
              </span>

              {/* Drag Handle */}
              <span
                style={{
                  color: '#d1d5db',
                  fontSize: 14,
                  cursor: 'grab',
                  padding: '0 4px',
                }}
              >
                ⋮⋮
              </span>
            </div>
          );
        })}

        {/* Separator between visible and hidden */}
        {filteredColumns.some(k => visibleColumns.includes(k)) &&
         filteredColumns.some(k => hiddenColumns.includes(k)) && (
          <div style={{
            margin: '8px 12px',
            borderTop: '1px solid #e5e7eb',
            paddingTop: 8,
          }}>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>Hidden columns</span>
          </div>
        )}

        {/* Hidden columns section */}
        {filteredColumns.filter(k => hiddenColumns.includes(k)).map((key) => {
          const isDragging = draggedItem === key;
          const isDragOver = dragOverItem === key;

          return (
            <div
              key={key}
              draggable
              onDragStart={(e) => handleDragStart(e, key)}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, key)}
              onDragEnd={handleDragEnd}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                cursor: 'grab',
                background: isDragOver ? '#f0f9ff' : isDragging ? '#f3f4f6' : 'transparent',
                borderTop: isDragOver ? '2px solid #3b82f6' : '2px solid transparent',
                opacity: isDragging ? 0.5 : 1,
                transition: 'background 0.15s',
              }}
            >
              {/* Visibility Toggle */}
              <button
                onClick={() => toggleColumn(key)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: 'none',
                  background: '#e5e7eb',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  marginRight: 8,
                  flexShrink: 0,
                }}
              >
                {''}
              </button>

              {/* Column Icon */}
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: '#6b7280',
                  marginRight: 8,
                  flexShrink: 0,
                }}
              >
                {getColumnIcon(key)}
              </span>

              {/* Column Name */}
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: '#9ca3af',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getColumnTitle(key)}
              </span>

              {/* Drag Handle */}
              <span
                style={{
                  color: '#d1d5db',
                  fontSize: 14,
                  cursor: 'grab',
                  padding: '0 4px',
                }}
              >
                ⋮⋮
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 12px',
          borderTop: '1px solid #f3f4f6',
        }}
      >
        <button
          onClick={hideAll}
          style={{
            flex: 1,
            padding: '6px 12px',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            background: 'white',
            color: '#374151',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Hide all
        </button>
        <button
          onClick={showAll}
          style={{
            flex: 1,
            padding: '6px 12px',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            background: 'white',
            color: '#374151',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Show all
        </button>
      </div>
    </div>
  );
};

export default ColumnsPopover;
