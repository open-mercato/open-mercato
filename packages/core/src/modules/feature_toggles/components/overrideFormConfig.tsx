"use client"
import { CrudFormGroup, CrudCustomFieldRenderProps, CrudField } from "@open-mercato/ui/backend/CrudForm";
import { JsonBuilder } from "@open-mercato/ui/backend/JsonBuilder";
import { Input } from "@open-mercato/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-mercato/ui/primitives/select";
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function renderOverrideValueComponent(props: CrudCustomFieldRenderProps) {
    const t = useT()
    const toggleType = props.values?.toggleType as string;
    const isOverride = props.values?.isOverride as boolean;

    if (!isOverride) {
        return (
            <div className="text-sm text-muted-foreground p-4 text-center bg-muted/30 rounded border border-dashed">
                {t('feature_toggles.override.disabled', 'Override is disabled. Values will be inherited from the default configuration.')}
            </div>
        );
    }

    switch (toggleType) {
        case 'boolean':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.override.fields.value.boolean.label', 'Override Value (Boolean)')}</label>
                    <Select
                        value={props.value as string || 'false'}
                        onValueChange={(value) => props.setValue(value === 'true')}
                        disabled={props.disabled}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="true">{t('feature_toggles.values.true', 'True')}</SelectItem>
                            <SelectItem value="false">{t('feature_toggles.values.false', 'False')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            );

        case 'string':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.override.fields.value.string.label', 'Override Value (String)')}</label>
                    <Input
                        type="text"
                        value={props.value as string || ''}
                        onChange={(e) => props.setValue(e.target.value)}
                        placeholder={t('feature_toggles.override.fields.value.string.placeholder', 'Enter override string value')}
                        disabled={props.disabled}
                        autoFocus={props.autoFocus}
                    />
                </div>
            );

        case 'number':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.override.fields.value.number.label', 'Override Value (Number)')}</label>
                    <Input
                        type="number"
                        value={props.value as number || 0}
                        onChange={(e) => props.setValue(Number(e.target.value) || 0)}
                        disabled={props.disabled}
                        autoFocus={props.autoFocus}
                    />
                </div>
            );

        case 'json':
            return (
                <div>
                    <label className="block text-sm font-medium mb-2">{t('feature_toggles.override.fields.value.json.label', 'Override Value (JSON)')}</label>
                    <JsonBuilder
                        value={props.value}
                        onChange={props.setValue}
                        disabled={props.disabled}
                    />
                </div>
            );

        default:
            return (
                <div className="text-sm text-muted-foreground p-4 text-center bg-muted/30 rounded border border-dashed">
                    {t('feature_toggles.override.unknownType', 'Unknown toggle type. Cannot configure override value.')}
                </div>
            );
    }
}

export function createOverrideFieldDefinitions(
    t: (key: string) => string,
): CrudField[] {
    return [
        {
            id: 'isOverride',
            label: t('feature_toggles.override.fields.isOverride.label'),
            type: 'checkbox',
            required: false,
            description: t('feature_toggles.override.fields.isOverride.description'),
        },
        {
            id: 'overrideValue',
            label: '',
            type: 'custom',
            component: renderOverrideValueComponent,
            description: t('feature_toggles.override.fields.overrideValue.description'),
        },
    ]
}

export function createOverrideFormGroups(
    t: (key: string) => string,
): CrudFormGroup[] {
    return [
        {
            id: 'overrideMode',
            title: t('feature_toggles.override.groups.mode'),
            column: 1,
            fields: ['isOverride'],
        },
        {
            id: 'overrideValue',
            title: t('feature_toggles.override.groups.value'),
            column: 1,
            fields: ['overrideValue'],
        },
    ]
}
