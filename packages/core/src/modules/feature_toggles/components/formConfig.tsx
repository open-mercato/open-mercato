import { CrudFormGroup, CrudCustomFieldRenderProps, CrudField } from "@open-mercato/ui/backend/CrudForm";
import { JsonBuilder } from "@open-mercato/ui/backend/JsonBuilder";
import { useT } from '@/lib/i18n/context'


export function renderDefaultValueCreateComponent(props: CrudCustomFieldRenderProps) {
    const t = useT()
    const selectedType = props.values?.type as string;

    switch (selectedType) {
        case 'boolean':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.form.fields.defaultValue.boolean.label', 'Default Value (Boolean)')}</label>
                    <select
                        value={props.value as string || 'false'}
                        onChange={(e) => props.setValue(e.target.value === 'true')}
                        className="w-full h-9 rounded border px-2 text-sm"
                        disabled={props.disabled}
                    >
                        <option value="true">{t('feature_toggles.values.true', 'True')}</option>
                        <option value="false">{t('feature_toggles.values.false', 'False')}</option>
                    </select>
                </div>
            );

        case 'string':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.form.fields.defaultValue.string.label', 'Default Value (String)')}</label>
                    <input
                        type="text"
                        value={props.value as string || ''}
                        onChange={(e) => props.setValue(e.target.value)}
                        placeholder={t('feature_toggles.form.fields.defaultValue.string.placeholder', 'Enter default string value')}
                        className="w-full h-9 rounded border px-2 text-sm"
                        disabled={props.disabled}
                        autoFocus={props.autoFocus}
                    />
                </div>
            );

        case 'number':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.form.fields.defaultValue.number.label', 'Default Value (Number)')}</label>
                    <input
                        type="number"
                        value={props.value as number || 0}
                        onChange={(e) => props.setValue(Number(e.target.value) || 0)}
                        className="w-full h-9 rounded border px-2 text-sm"
                        disabled={props.disabled}
                        autoFocus={props.autoFocus}
                    />
                </div>
            );

        case 'json':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.form.fields.defaultValue.json.label', 'Default Value (JSON)')}</label>
                    <JsonBuilder
                        value={props.value}
                        onChange={props.setValue}
                        disabled={props.disabled}
                    />
                </div>
            );

        default:
            return (
                <div className="text-sm text-muted-foreground p-4 text-center bg-muted/20 rounded border border-dashed">
                    {t('feature_toggles.form.fields.defaultValue.selectType', 'Please select a type above to configure the default value')}
                </div>
            );
    }
}

export function createFieldDefinitions(
    t: (key: string) => string,
): CrudField[] {
    return [
        {
            id: 'identifier',
            label: t('feature_toggles.form.fields.identifier.label'),
            type: 'text',
            required: true,
        },
        {
            id: 'name',
            label: t('feature_toggles.form.fields.name.label'),
            type: 'text',
            required: true,
        },
        {
            id: 'description',
            label: t('feature_toggles.form.fields.description.label'),
            type: 'textarea',
            required: false,
        },
        {
            id: 'category',
            label: t('feature_toggles.form.fields.category.label'),
            type: 'text',
            required: false,
        },
        {
            id: 'type',
            label: t('feature_toggles.form.fields.type.label'),
            type: 'select',
            required: true,
            options: [
                { label: t('feature_toggles.types.boolean'), value: 'boolean' },
                { label: t('feature_toggles.types.string'), value: 'string' },
                { label: t('feature_toggles.types.number'), value: 'number' },
                { label: t('feature_toggles.types.json'), value: 'json' },
            ],
        },
        {
            id: 'defaultValue',
            label: '',
            type: 'custom',
            component: renderDefaultValueCreateComponent,
            description: t('feature_toggles.form.fields.defaultValue.description'),
        },
    ]
}

export function createFormGroups(
    t: (key: string) => string,
): CrudFormGroup[] {
    return [
        {
            id: 'basic',
            title: t('feature_toggles.form.groups.basic'),
            column: 1,
            fields: [
                'identifier',
                'name',
                'description',
                'category',
            ],
        },
        {
            id: 'type',
            title: t('feature_toggles.form.groups.type'),
            column: 1,
            fields: ['type'],
        },
        {
            id: 'defaultValue',
            title: t('feature_toggles.form.groups.defaultValue'),
            column: 1,
            fields: ['defaultValue'],
        },
    ]
}
