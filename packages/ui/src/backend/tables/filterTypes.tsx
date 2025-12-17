export type FilterOperator = 
  | 'is_any_of'
  | 'is_not_any_of'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'is_true'
  | 'is_false';

export interface FilterRow {
  id: string;
  field: string;
  operator: FilterOperator;
  values: string[];
}

export interface SavedFilter {
  id: string;
  name: string;
  rows: FilterRow[];
}

export const getOperatorsForType = (type?: 'text' | 'numeric' | 'boolean'): { value: FilterOperator; label: string }[] => {
  const common = [
    { value: 'is_any_of' as FilterOperator, label: 'is any of' },
    { value: 'is_not_any_of' as FilterOperator, label: 'is not any of' },
    { value: 'is_empty' as FilterOperator, label: 'is empty' },
    { value: 'is_not_empty' as FilterOperator, label: 'is not empty' },
  ];

  if (type === 'numeric') {
    return [
      ...common,
      { value: 'equals' as FilterOperator, label: 'equals' },
      { value: 'not_equals' as FilterOperator, label: 'not equals' },
      { value: 'greater_than' as FilterOperator, label: 'greater than' },
      { value: 'less_than' as FilterOperator, label: 'less than' },
    ];
  }

  if (type === 'boolean') {
    return [
      { value: 'is_true' as FilterOperator, label: 'is true' },
      { value: 'is_false' as FilterOperator, label: 'is false' },
    ];
  }

  return [
    ...common,
    { value: 'contains' as FilterOperator, label: 'contains' },
  ];
};

export const needsValueInput = (operator: FilterOperator): boolean => {
  return !['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(operator);
};

export const needsMultipleValues = (operator: FilterOperator): boolean => {
  return ['is_any_of', 'is_not_any_of'].includes(operator);
};

export const applyFilters = (data: any[], filters: FilterRow[], columns: any[]): any[] => {
  if (filters.length === 0) return data;

  return data.filter(row => {
    return filters.every(filter => {
      const value = row[filter.field];
      const stringValue = String(value ?? '').toLowerCase();

      switch (filter.operator) {
        case 'is_any_of':
          return filter.values.some(v => String(value) === v);
        case 'is_not_any_of':
          return !filter.values.some(v => String(value) === v);
        case 'contains':
          return filter.values.some(v => stringValue.includes(v.toLowerCase()));
        case 'is_empty':
          return !value || stringValue === '';
        case 'is_not_empty':
          return !!value && stringValue !== '';
        case 'equals':
          return Number(value) === Number(filter.values[0]);
        case 'not_equals':
          return Number(value) !== Number(filter.values[0]);
        case 'greater_than':
          return Number(value) > Number(filter.values[0]);
        case 'less_than':
          return Number(value) < Number(filter.values[0]);
        case 'is_true':
          return value === true || value === 'true';
        case 'is_false':
          return value === false || value === 'false';
        default:
          return true;
      }
    });
  });
};