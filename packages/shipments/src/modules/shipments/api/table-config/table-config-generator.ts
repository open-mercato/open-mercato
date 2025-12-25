// Utility to generate table column configs from MikroORM entity metadata
import { EntityMetadata } from '@mikro-orm/core';

export type TableColumnType = 'text' | 'numeric' | 'date' | 'dropdown' | 'checkbox';

export interface TableColumnConfig {
    data: string;
    title: string;
    width: number;
    type?: TableColumnType;
    dateFormat?: string;
    readOnly?: boolean;
    source?: string[];
    renderer?: string; // name of custom renderer to use
}

export interface DisplayHints {
    fieldOrder?: string[];
    fieldLabels?: Record<string, string>;
    columnWidths?: Record<string, number>;
    hiddenFields?: string[];
    readOnlyFields?: string[];
    customRenderers?: Record<string, string>;
}

// Map MikroORM property types to table column types
function mapPropertyTypeToColumnType(property: any): TableColumnType {
    const typeName = property.type?.toLowerCase() || '';

    // Handle different type formats
    if (typeName.includes('varchar') || typeName.includes('text') || typeName.includes('string')) {
        return 'text';
    }

    if (typeName.includes('int') || typeName.includes('numeric') || typeName.includes('decimal') || typeName.includes('float')) {
        return 'numeric';
    }

    if (typeName.includes('timestamp') || typeName.includes('date')) {
        return 'date';
    }

    if (typeName.includes('bool')) {
        return 'checkbox';
    }

    // Check if it's an enum
    if (property.enum) {
        return 'dropdown';
    }

    return 'text';
}

// Get default width based on field type
function getDefaultWidth(columnType: TableColumnType, fieldName: string): number {
    if (fieldName.includes('email')) return 200;
    if (fieldName.includes('reference') || fieldName.includes('number')) return 150;

    switch (columnType) {
        case 'date':
            return 120;
        case 'numeric':
            return 100;
        case 'checkbox':
            return 80;
        default:
            return 150;
    }
}

// Convert snake_case to Title Case
function snakeCaseToTitle(str: string): string {
    return str
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Convert camelCase to Title Case
function camelCaseToTitle(str: string): string {
    const result = str.replace(/([A-Z])/g, ' $1');
    return result.charAt(0).toUpperCase() + result.slice(1);
}

export function generateTableConfig(
    entityMetadata: EntityMetadata,
    hints: DisplayHints = {}
): TableColumnConfig[] {
    const columns: TableColumnConfig[] = [];
    const properties = entityMetadata.properties;

    // Get field order (either from hints or default property order)
    const fieldOrder = hints.fieldOrder || Object.keys(properties);
    const hiddenFields = new Set([
        'id',
        'tenantId',
        'organizationId',
        'tenant_id',
        'organization_id',
        ...(hints.hiddenFields || [])
    ]);

    // Build columns based on field order
    for (const fieldName of fieldOrder) {
        const property = properties[fieldName];

        // Skip if property doesn't exist or is hidden
        if (!property || hiddenFields.has(fieldName)) {
            continue;
        }

        // Skip primary keys and internal fields
        if (property.primary) {
            continue;
        }

        const columnType = mapPropertyTypeToColumnType(property);

        // Determine the data accessor (convert to camelCase for frontend)
        const dataAccessor = fieldName.includes('_')
            ? fieldName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
            : fieldName;

        // Get display label
        const label = hints.fieldLabels?.[fieldName]
            || hints.fieldLabels?.[dataAccessor]
            || camelCaseToTitle(dataAccessor);

        // Get width
        const width = hints.columnWidths?.[fieldName]
            || hints.columnWidths?.[dataAccessor]
            || getDefaultWidth(columnType, fieldName);

        const column: TableColumnConfig = {
            data: dataAccessor,
            title: label,
            width,
            type: columnType !== 'text' ? columnType : undefined,
        };

        // Add date format for date columns
        if (columnType === 'date') {
            column.dateFormat = 'dd/MM/yyyy';
        }

        // Add enum source for dropdowns
        if (property.enum && columnType === 'dropdown') {
            const enumValues = Object.values(property.items?.() || {});
            column.source = enumValues as string[];
        }

        // Check if field should be read-only
        if (hints.readOnlyFields?.includes(fieldName) || hints.readOnlyFields?.includes(dataAccessor)) {
            column.readOnly = true;
        }

        // Add custom renderer if specified
        if (hints.customRenderers?.[fieldName] || hints.customRenderers?.[dataAccessor]) {
            column.renderer = hints.customRenderers[fieldName] || hints.customRenderers[dataAccessor];
        }

        columns.push(column);
    }

    return columns;
}

// Helper to add relationship columns (for display purposes)
export function addRelationshipColumns(
    columns: TableColumnConfig[],
    relationships: Array<{ name: string; displayFields: string[] }>
): TableColumnConfig[] {
    const enrichedColumns = [...columns];

    for (const rel of relationships) {
        for (const displayField of rel.displayFields) {
            const fieldName = `${rel.name}${displayField.charAt(0).toUpperCase()}${displayField.slice(1)}`;

            enrichedColumns.push({
                data: fieldName,
                title: `${camelCaseToTitle(rel.name)} ${camelCaseToTitle(displayField)}`,
                width: displayField.includes('email') ? 200 : 180,
                readOnly: true,
            });
        }
    }

    return enrichedColumns;
}