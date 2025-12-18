

export type CellValidatorFunction = (
    value: any,
    rowData: any,
    columnConfig: any
) => { valid: boolean; error?: string };


export const defaultValidator: CellValidatorFunction = (value, rowData, columnConfig) => {
    return { valid: true, error: undefined };
};


export const requiredValidator: CellValidatorFunction = (value, rowData, columnConfig) => {
    if (value === null || value === undefined || value === '') {
        return { valid: false, error: 'Value is required' };
    }
    return { valid: true, error: undefined };
};

export const emailValidator: CellValidatorFunction = (value, rowData, columnConfig) => {
    if (!value || !value.includes('@')) {
        return { valid: false, error: 'Invalid email address' };
    }
    return { valid: true, error: undefined };
};


export const numberValidator: CellValidatorFunction = (value, rowData, columnConfig) => {
    if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: 'Value is not a number' };
    }
    return { valid: true, error: undefined };
};

export const dateValidator: CellValidatorFunction = (value, rowData, columnConfig) => {
    const isValidDate = isNaN(new Date(value).getTime());
    if (typeof value !== 'string' || isValidDate) {
        return { valid: false, error: 'Invalid date' };
    }
    return { valid: true, error: undefined };
};  