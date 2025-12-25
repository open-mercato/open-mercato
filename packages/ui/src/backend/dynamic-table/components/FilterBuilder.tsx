import React, { useState, useCallback } from 'react';
import { FilterRow, FilterOperator, getOperatorsForType, needsValueInput, needsMultipleValues } from '../types/filters';
import { FilterColor } from '../types/index';

// Color palette similar to Airtable
const COLOR_PALETTE: { color: FilterColor; bg: string; border: string }[] = [
  { color: 'blue', bg: '#dbeafe', border: '#93c5fd' },
  { color: 'green', bg: '#dcfce7', border: '#86efac' },
  { color: 'teal', bg: '#ccfbf1', border: '#5eead4' },
  { color: 'purple', bg: '#f3e8ff', border: '#d8b4fe' },
  { color: 'pink', bg: '#fce7f3', border: '#f9a8d4' },
  { color: 'red', bg: '#fee2e2', border: '#fca5a5' },
  { color: 'orange', bg: '#ffedd5', border: '#fdba74' },
  { color: 'yellow', bg: '#fef9c3', border: '#fde047' },
];

interface FilterBuilderProps {
  columns: any[];
  filterRows: FilterRow[];
  onFilterRowsChange: (rows: FilterRow[]) => void;
  onClear: () => void;
  onSave: (name: string, color?: FilterColor) => void;
  isExpanded: boolean;
  onToggle: () => void;
}

const FilterBuilder: React.FC<FilterBuilderProps> = ({
  columns,
  filterRows,
  onFilterRowsChange,
  onClear,
  onSave,
  isExpanded,
  onToggle,
}) => {
  const [filterName, setFilterName] = useState('');
  const [selectedColor, setSelectedColor] = useState<FilterColor>('blue');

  const addFilterRow = useCallback(() => {
    const newRow: FilterRow = {
      id: `filter-${Date.now()}`,
      field: columns[0]?.data || '',
      operator: 'is_any_of',
      values: [],
    };
    onFilterRowsChange([...filterRows, newRow]);
  }, [columns, filterRows, onFilterRowsChange]);

  const removeFilterRow = useCallback((id: string) => {
    onFilterRowsChange(filterRows.filter(row => row.id !== id));
  }, [filterRows, onFilterRowsChange]);

  const updateFilterRow = useCallback((id: string, updates: Partial<FilterRow>) => {
    onFilterRowsChange(filterRows.map(row =>
      row.id === id ? { ...row, ...updates } : row
    ));
  }, [filterRows, onFilterRowsChange]);

  const handleValueAdd = useCallback((id: string, value: string) => {
    const row = filterRows.find(r => r.id === id);
    if (row && value.trim()) {
      updateFilterRow(id, { values: [...row.values, value.trim()] });
    }
  }, [filterRows, updateFilterRow]);

  const handleValueRemove = useCallback((id: string, valueIndex: number) => {
    const row = filterRows.find(r => r.id === id);
    if (row) {
      updateFilterRow(id, { values: row.values.filter((_, i) => i !== valueIndex) });
    }
  }, [filterRows, updateFilterRow]);

  const handleOperatorChange = useCallback((id: string, operator: FilterOperator) => {
    updateFilterRow(id, { operator, values: [] });
  }, [updateFilterRow]);

  return (
    <div className="filter-builder">
      {isExpanded && (
        <>
          <div className="filter-builder-header">
            <div className="filter-name-row">
              <input
                type="text"
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder="Enter filter name..."
                className="filter-name-input"
              />
              <div className="filter-color-picker">
                {COLOR_PALETTE.map((item) => (
                  <button
                    key={item.color}
                    className={`filter-color-swatch ${selectedColor === item.color ? 'selected' : ''}`}
                    style={{
                      backgroundColor: item.bg,
                      borderColor: selectedColor === item.color ? item.border : 'transparent',
                    }}
                    onClick={() => setSelectedColor(item.color)}
                    title={item.color}
                  />
                ))}
              </div>
            </div>
            <div className="filter-actions">
              <button onClick={onClear} className="filter-btn filter-btn-secondary">
                Clear All
              </button>
              <button
                onClick={() => {
                  if (filterName.trim()) {
                    onSave(filterName.trim(), selectedColor);
                    setFilterName('');
                  }
                }}
                className="filter-btn filter-btn-primary"
                disabled={!filterName.trim()}
              >
                Save Filter
              </button>
            </div>
          </div>

          <div className="filter-rows">
            {filterRows.map((row, index) => {
              const column = columns.find(c => c.data === row.field);
              const operators = getOperatorsForType(column?.type);
              const showValueInput = needsValueInput(row.operator as FilterOperator);
              const isMultiValue = needsMultipleValues(row.operator as FilterOperator);

              return (
                <div key={row.id} className="filter-row">
                  <select
                    value={row.field}
                    onChange={(e) => updateFilterRow(row.id, { field: e.target.value })}
                    className="filter-select filter-field"
                  >
                    {columns.map(col => (
                      <option key={col.data} value={col.data}>
                        {col.title || col.data}
                      </option>
                    ))}
                  </select>

                  <select
                    value={row.operator}
                    onChange={(e) => handleOperatorChange(row.id, e.target.value as FilterOperator)}
                    className="filter-select filter-operator"
                  >
                    {operators.map(op => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>

                  {showValueInput && (
                    <div className="filter-values">
                      {isMultiValue && row.values.map((value, idx) => (
                        <span key={idx} className="filter-pill">
                          {value}
                          <button
                            onClick={() => handleValueRemove(row.id, idx)}
                            className="filter-pill-remove"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        placeholder={isMultiValue ? "Add value..." : "Enter value..."}
                        className="filter-input"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const value = e.currentTarget.value;
                            if (isMultiValue) {
                              handleValueAdd(row.id, value);
                              e.currentTarget.value = '';
                            } else {
                              updateFilterRow(row.id, { values: [value] });
                            }
                          }
                        }}
                        defaultValue={!isMultiValue ? row.values[0] || '' : ''}
                      />
                    </div>
                  )}

                  <div className="filter-row-actions">
                    {index === filterRows.length - 1 && (
                      <button
                        onClick={addFilterRow}
                        className="filter-icon-btn"
                        title="Add filter"
                      >
                        +
                      </button>
                    )}
                    <button
                      onClick={() => removeFilterRow(row.id)}
                      className="filter-icon-btn"
                      title="Remove filter"
                    >
                      −
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default FilterBuilder;
