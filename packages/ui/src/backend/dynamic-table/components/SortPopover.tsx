import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ColumnDef } from '../types/index';
import { SortRule, generateSortRuleId } from '../types/perspective';

interface SortPopoverProps {
  columns: ColumnDef[];
  sortRules: SortRule[];
  onSortRulesChange: (rules: SortRule[]) => void;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const SortPopover: React.FC<SortPopoverProps> = ({
  columns,
  sortRules,
  onSortRulesChange,
  isOpen,
  onClose,
  anchorRef,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  // Add new sort rule
  const addSortRule = useCallback(() => {
    // Find first column not already in sort rules
    const usedFields = sortRules.map(r => r.field);
    const availableColumn = columns.find(c => !usedFields.includes(c.data));

    const newRule: SortRule = {
      id: generateSortRuleId(),
      field: availableColumn?.data || columns[0]?.data || '',
      direction: 'asc',
    };
    onSortRulesChange([...sortRules, newRule]);
  }, [columns, sortRules, onSortRulesChange]);

  // Remove sort rule
  const removeSortRule = useCallback((id: string) => {
    onSortRulesChange(sortRules.filter(rule => rule.id !== id));
  }, [sortRules, onSortRulesChange]);

  // Update sort rule
  const updateSortRule = useCallback((id: string, updates: Partial<SortRule>) => {
    onSortRulesChange(sortRules.map(rule =>
      rule.id === id ? { ...rule, ...updates } : rule
    ));
  }, [sortRules, onSortRulesChange]);

  // Toggle direction
  const toggleDirection = useCallback((id: string) => {
    const rule = sortRules.find(r => r.id === id);
    if (rule) {
      updateSortRule(id, { direction: rule.direction === 'asc' ? 'desc' : 'asc' });
    }
  }, [sortRules, updateSortRule]);

  // Clear all sort rules
  const clearAll = useCallback(() => {
    onSortRulesChange([]);
  }, [onSortRulesChange]);

  // Drag handlers for reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && index !== draggedIndex) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newRules = [...sortRules];
    const [draggedRule] = newRules.splice(draggedIndex, 1);
    newRules.splice(targetIndex, 0, draggedRule);

    onSortRulesChange(newRules);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Get available columns (not already used in other rules)
  const getAvailableColumns = (currentRuleId: string) => {
    const usedFields = sortRules
      .filter(r => r.id !== currentRuleId)
      .map(r => r.field);
    return columns.filter(c => !usedFields.includes(c.data));
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="perspective-popover sort-popover"
      style={{
        position: 'fixed',
        zIndex: 10000,
        background: 'white',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        border: '1px solid #e5e7eb',
        width: 320,
        maxHeight: 400,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid #f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          Sort by
        </span>
        <button
          onClick={clearAll}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Clear all
        </button>
      </div>

      {/* Sort Rules */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {sortRules.length === 0 ? (
          <div style={{
            padding: '20px 0',
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: 13,
          }}>
            No sorting applied
          </div>
        ) : (
          sortRules.map((rule, index) => {
            const availableColumns = getAvailableColumns(rule.id);
            const currentColumn = columns.find(c => c.data === rule.field);
            const isDragging = draggedIndex === index;
            const isDragOver = dragOverIndex === index;

            return (
              <div
                key={rule.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: index < sortRules.length - 1 ? '1px solid #f3f4f6' : 'none',
                  background: isDragOver ? '#f0f9ff' : isDragging ? '#f3f4f6' : 'transparent',
                  borderTop: isDragOver ? '2px solid #3b82f6' : '2px solid transparent',
                  opacity: isDragging ? 0.5 : 1,
                  cursor: 'grab',
                }}
              >
                {/* Priority Number */}
                <span style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: '#6b7280',
                  flexShrink: 0,
                }}>
                  {index + 1}
                </span>

                {/* Field Select */}
                <select
                  value={rule.field}
                  onChange={(e) => updateSortRule(rule.id, { field: e.target.value })}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    fontSize: 12,
                    background: 'white',
                    cursor: 'pointer',
                  }}
                >
                  {/* Current selection (always show) */}
                  {currentColumn && (
                    <option value={currentColumn.data}>
                      {currentColumn.title || currentColumn.data}
                    </option>
                  )}
                  {/* Available options */}
                  {availableColumns
                    .filter(c => c.data !== rule.field)
                    .map(col => (
                      <option key={col.data} value={col.data}>
                        {col.title || col.data}
                      </option>
                    ))}
                </select>

                {/* Direction Toggle */}
                <button
                  onClick={() => toggleDirection(rule.id)}
                  style={{
                    padding: '6px 10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    background: 'white',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: '#374151',
                    minWidth: 70,
                  }}
                >
                  {rule.direction === 'asc' ? '↑ A-Z' : '↓ Z-A'}
                </button>

                {/* Remove Button */}
                <button
                  onClick={() => removeSortRule(rule.id)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: '#fee2e2',
                    color: '#dc2626',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid #f3f4f6',
      }}>
        <button
          onClick={addSortRule}
          disabled={sortRules.length >= columns.length}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px dashed #d1d5db',
            borderRadius: 6,
            background: 'white',
            color: sortRules.length >= columns.length ? '#d1d5db' : '#6b7280',
            fontSize: 12,
            cursor: sortRules.length >= columns.length ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>+</span>
          Add sort
        </button>
      </div>
    </div>
  );
};

export default SortPopover;
