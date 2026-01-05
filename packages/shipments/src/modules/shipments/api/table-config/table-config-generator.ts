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
    renderer?: string;
}

export interface DisplayHints {
    hiddenFields?: string[];
    readOnlyFields?: string[];
    customRenderers?: Record<string, string>;
}

// Map MikroORM property types to table column types
function mapPropertyTypeToColumnType(property: any): TableColumnType {
    const typeName = property.type?.toLowerCase() || '';

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

    if (property.enum) {
        return 'dropdown';
    }

    return 'text';
}

// Get default width based on column type
function getDefaultWidth(columnType: TableColumnType): number {
    switch (columnType) {
        case 'date':
            return 120;
        case 'numeric':
            return 100;
        case 'checkbox':
            return 80;
        case 'dropdown':
            return 130;
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

// Convert camelCase to snake_case then to Title Case
function fieldNameToTitle(fieldName: string): string {
    // If already snake_case, use snakeCaseToTitle directly
    if (fieldName.includes('_')) {
        return snakeCaseToTitle(fieldName);
    }
    // Convert camelCase to snake_case first, then to title
    const snakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
    return snakeCaseToTitle(snakeCase);
}

export function generateTableConfig(
    entityMetadata: EntityMetadata,
    hints: DisplayHints = {}
): TableColumnConfig[] {
    const columns: TableColumnConfig[] = [];
    const properties = entityMetadata.properties;

    // Default hidden fields + user-specified hidden fields
    const hiddenFields = new Set([
        'id',
        'tenantId',
        'organizationId',
        'tenant_id',
        'organization_id',
        ...(hints.hiddenFields || [])
    ]);

    // Iterate over all properties in their natural order
    for (const [fieldName, property] of Object.entries(properties)) {
        // Skip hidden fields
        if (hiddenFields.has(fieldName)) {
            continue;
        }

        // Skip primary keys
        if ((property as any).primary) {
            continue;
        }

        // Skip relationship fields (they have reference property)
        if ((property as any).reference) {
            continue;
        }

        const columnType = mapPropertyTypeToColumnType(property);

        // Convert to camelCase for frontend data accessor
        const dataAccessor = fieldName.includes('_')
            ? fieldName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
            : fieldName;

        // Auto-generate label from field name
        const label = fieldNameToTitle(fieldName);

        // Width based on datatype
        const width = getDefaultWidth(columnType);

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
        if ((property as any).enum && columnType === 'dropdown') {
            const enumValues = Object.values((property as any).items?.() || {});
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
