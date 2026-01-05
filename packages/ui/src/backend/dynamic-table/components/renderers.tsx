import { format, parseISO, isValid } from 'date-fns';

export type CellRendererFunction = (
  value: any,
  rowData: any,
  columnConfig: any,
  rowIndex?: number,
  colIndex?: number
) => React.ReactNode;

// Text renderer (default)
export const textRenderer: CellRendererFunction = (value) => {
  return value ?? '';
};

// Numeric renderer
export const numericRenderer: CellRendererFunction = (value, rowData, columnConfig) => {
  if (value === null || value === undefined || value === '') return '';

  try {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return value;

    const locale = columnConfig.numericFormat?.locale || 'en-US';
    const options = { ...columnConfig.numericFormat };
    delete options.locale;

    // Default format if no options provided
    if (Object.keys(options).length === 0) {
      options.minimumFractionDigits = 2;
      options.maximumFractionDigits = 2;
    }

    return new Intl.NumberFormat(locale, options).format(num);
  } catch (error) {
    return value;
  }
};

// Date renderer
export const dateRenderer: CellRendererFunction = (value, rowData, columnConfig) => {
  if (!value) return '';

  try {
    const dateFormat = columnConfig.dateFormat || 'yyyy-MM-dd';

    let date: Date;
    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'string') {
      date = parseISO(value);
    } else if (typeof value === 'number') {
      date = new Date(value);
    } else {
      return value;
    }

    if (!isValid(date)) return value;

    return format(date, dateFormat);
  } catch (error) {
    return value;
  }
};

// Get renderer function based on column type
export const getCellRenderer = (columnConfig: any): CellRendererFunction => {
  // Custom renderer takes precedence
  if (typeof columnConfig.renderer === 'function') {
    return columnConfig.renderer;
  }

  // Built-in renderers
  switch (columnConfig.type) {
    case 'numeric':
      return numericRenderer;
    case 'date':
      return dateRenderer;
    case 'text':
    default:
      return textRenderer;
  }
};
