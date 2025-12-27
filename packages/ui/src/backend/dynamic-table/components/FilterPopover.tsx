import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ColumnDef, FilterRow } from '../types/index';
import { FilterOperator, getOperatorsForType, needsValueInput, needsMultipleValues } from '../types/filters';

// Debounce delay in milliseconds
const DEBOUNCE_DELAY = 500;

// Debounced filter value input component
interface FilterValueInputProps {
  filterId: string;
  initialValue: string;
  isMultiValue: boolean;
  onValueChange: (id: string, value: string) => void;
  onValueAdd: (id: string, value: string) => void;
}

const FilterValueInput: React.FC<FilterValueInputProps> = ({
  filterId,
  initialValue,
  isMultiValue,
  onValueChange,
  onValueAdd,
}) => {
  const [localValue, setLocalValue] = useState(initialValue);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local value when initialValue changes (e.g., filter reset)
  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalValue(value);

    // Only debounce for single-value inputs
    if (!isMultiValue) {
      // Clear previous timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new debounced update
      debounceTimerRef.current = setTimeout(() => {
        onValueChange(filterId, value);
      }, DEBOUNCE_DELAY);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Clear any pending debounce
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (isMultiValue) {
        onValueAdd(filterId, localValue);
        setLocalValue('');
      } else {
        onValueChange(filterId, localValue);
      }
    }
  };

  const handleBlur = () => {
    // Clear any pending debounce and apply immediately on blur
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!isMultiValue) {
      onValueChange(filterId, localValue);
    }
  };

  return (
    <input
      type="text"
      placeholder={isMultiValue ? "Add value (Enter)" : "Enter value"}
      value={localValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        flex: 1,
        minWidth: 100,
        padding: '6px 8px',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        fontSize: 12,
        outline: 'none',
      }}
    />
  );
};

interface FilterPopoverProps {
  columns: ColumnDef[];
  filters: FilterRow[];
  onFiltersChange: (filters: FilterRow[]) => void;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const FilterPopover: React.FC<FilterPopoverProps> = ({
  columns,
  filters,
  onFiltersChange,
  isOpen,
  onClose,
  anchorRef,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

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

  // Add new filter row
  const addFilterRow = useCallback(() => {
    const newRow: FilterRow = {
      id: `filter-${Date.now()}`,
      field: columns[0]?.data || '',
      operator: 'contains',
      values: [],
    };
    onFiltersChange([...filters, newRow]);
  }, [columns, filters, onFiltersChange]);

  // Remove filter row
  const removeFilterRow = useCallback((id: string) => {
    onFiltersChange(filters.filter(row => row.id !== id));
  }, [filters, onFiltersChange]);

  // Update filter row
  const updateFilterRow = useCallback((id: string, updates: Partial<FilterRow>) => {
    onFiltersChange(filters.map(row =>
      row.id === id ? { ...row, ...updates } : row
    ));
  }, [filters, onFiltersChange]);

  // Handle value add for multi-value operators
  const handleValueAdd = useCallback((id: string, value: string) => {
    const row = filters.find(r => r.id === id);
    if (row && value.trim()) {
      updateFilterRow(id, { values: [...row.values, value.trim()] });
    }
  }, [filters, updateFilterRow]);

  // Handle value remove
  const handleValueRemove = useCallback((id: string, valueIndex: number) => {
    const row = filters.find(r => r.id === id);
    if (row) {
      updateFilterRow(id, { values: row.values.filter((_, i) => i !== valueIndex) });
    }
  }, [filters, updateFilterRow]);

  // Handle debounced single value change
  const handleDebouncedValueChange = useCallback((id: string, value: string) => {
    updateFilterRow(id, { values: value ? [value] : [] });
  }, [updateFilterRow]);

  // Handle operator change (reset values when operator changes)
  const handleOperatorChange = useCallback((id: string, operator: FilterOperator) => {
    updateFilterRow(id, { operator, values: [] });
  }, [updateFilterRow]);

  // Clear all filters
  const clearAll = useCallback(() => {
    onFiltersChange([]);
  }, [onFiltersChange]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="perspective-popover filter-popover"
      style={{
        position: 'fixed',
        zIndex: 10000,
        background: 'white',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        border: '1px solid #e5e7eb',
        width: 400,
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
          Filter by conditions
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

      {/* Filter Rows */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {filters.length === 0 ? (
          <div style={{
            padding: '20px 0',
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: 13,
          }}>
            No filters applied
          </div>
        ) : (
          filters.map((row, index) => {
            const column = columns.find(c => c.data === row.field);
            const operators = getOperatorsForType(column?.type);
            const showValueInput = needsValueInput(row.operator as FilterOperator);
            const isMultiValue = needsMultipleValues(row.operator as FilterOperator);

            return (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '8px 0',
                  borderBottom: index < filters.length - 1 ? '1px solid #f3f4f6' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Field Select */}
                  <select
                    value={row.field}
                    onChange={(e) => updateFilterRow(row.id, { field: e.target.value })}
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
                    {columns.map(col => (
                      <option key={col.data} value={col.data}>
                        {col.title || col.data}
                      </option>
                    ))}
                  </select>

                  {/* Operator Select */}
                  <select
                    value={row.operator}
                    onChange={(e) => handleOperatorChange(row.id, e.target.value as FilterOperator)}
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
                    {operators.map(op => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>

                  {/* Remove Button */}
                  <button
                    onClick={() => removeFilterRow(row.id)}
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

                {/* Value Input */}
                {showValueInput && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    {/* Value Pills (for multi-value) */}
                    {isMultiValue && row.values.map((value, idx) => (
                      <span
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 6px 2px 8px',
                          background: '#dbeafe',
                          borderRadius: 4,
                          fontSize: 11,
                          color: '#1e40af',
                        }}
                      >
                        {String(value)}
                        <button
                          onClick={() => handleValueRemove(row.id, idx)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#3b82f6',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: 12,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    {/* Debounced Value Input */}
                    <FilterValueInput
                      filterId={row.id}
                      initialValue={!isMultiValue ? (row.values[0] as string) || '' : ''}
                      isMultiValue={isMultiValue}
                      onValueChange={handleDebouncedValueChange}
                      onValueAdd={handleValueAdd}
                    />
                  </div>
                )}
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
          onClick={addFilterRow}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px dashed #d1d5db',
            borderRadius: 6,
            background: 'white',
            color: '#6b7280',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>+</span>
          Add filter
        </button>
      </div>
    </div>
  );
};

export default FilterPopover;
