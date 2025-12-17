import React, { useState, useCallback } from 'react';
import { FilterRow, FilterOperator, getOperatorsForType, needsValueInput, needsMultipleValues } from './filterTypes';
import { ColumnConfig } from './renderers';

interface FilterBuilderProps {
  columns: ColumnConfig[];
  filterRows: FilterRow[];
  onFilterRowsChange: (rows: FilterRow[]) => void;
  onClear: () => void;
  onSave: (name: string) => void;
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
            <input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder="Enter filter name..."
              className="filter-name-input"
            />
            <div className="filter-actions">
              <button onClick={onClear} className="filter-btn filter-btn-secondary">
                Clear All
              </button>
              <button 
                onClick={() => {
                  if (filterName.trim()) {
                    onSave(filterName.trim());
                    setFilterName('');
                  }
                }} 
                className="filter-btn filter-btn-secondary"
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
              const showValueInput = needsValueInput(row.operator);
              const isMultiValue = needsMultipleValues(row.operator);

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