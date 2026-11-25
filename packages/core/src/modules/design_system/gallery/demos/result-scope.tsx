"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { DesignScope, type DesignScopeShape } from '@open-mercato/ui/primitives/design-scope'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Result } from '@open-mercato/ui/primitives/result'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

export function ResultSuccessExample() {
  const t = useT()
  return (
    <Result
      className="w-full"
      status="success"
      title={t('design_system.gallery.samples.result.successTitle')}
      subtitle={t('design_system.gallery.samples.result.successSubtitle')}
      actions={
        <>
          <Button type="button">{t('design_system.gallery.samples.result.viewOrder')}</Button>
          <Button type="button" variant="outline">{t('design_system.gallery.samples.result.newOrder')}</Button>
        </>
      }
    />
  )
}

export function ResultErrorExample() {
  const t = useT()
  return (
    <Result
      className="w-full"
      status="error"
      title={t('design_system.gallery.samples.result.errorTitle')}
      subtitle={t('design_system.gallery.samples.result.errorSubtitle')}
      actions={<Button type="button">{t('design_system.gallery.samples.result.fix')}</Button>}
    >
      <p className="mb-2 text-foreground">{t('design_system.gallery.samples.result.reasonsTitle')}</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>{t('design_system.gallery.samples.result.reasonTax')}</li>
        <li>{t('design_system.gallery.samples.result.reasonAddress')}</li>
      </ul>
    </Result>
  )
}

export function ResultPageErrorsExample() {
  const t = useT()
  return (
    <div className="grid w-full gap-gutter md:grid-cols-3">
      {(['403', '404', '500'] as const).map((status) => (
        <div key={status} className="rounded-card border border-border bg-card">
          <Result
            status={status}
            size="compact"
            actions={<Button type="button" size="sm" variant="outline">{t('design_system.gallery.samples.result.back')}</Button>}
          />
        </div>
      ))}
    </div>
  )
}

export function ResultStatusesExample() {
  const t = useT()
  return (
    <div className="grid w-full gap-gutter sm:grid-cols-2">
      {(['info', 'warning'] as const).map((status) => (
        <div key={status} className="rounded-card border border-border bg-card">
          <Result
            status={status}
            size="compact"
            title={t(`design_system.gallery.samples.result.${status}Title`)}
            subtitle={t(`design_system.gallery.samples.result.${status}Subtitle`)}
          />
        </div>
      ))}
    </div>
  )
}

function ScopeSample() {
  const t = useT()
  return (
    <div className="flex flex-col gap-y-field-stack rounded-card border border-border bg-card p-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-base text-foreground">{t('design_system.gallery.samples.scope.title')}</p>
        <StatusBadge variant="success" dot>{t('design_system.gallery.samples.scope.status')}</StatusBadge>
      </div>
      <FormField label={t('design_system.gallery.samples.scope.field')} description={t('design_system.gallery.samples.scope.hint')}>
        <Input defaultValue="Northline Logistics" />
      </FormField>
      <div className="flex gap-2">
        <Button type="button" size="sm">{t('design_system.gallery.samples.scope.save')}</Button>
        <Button type="button" size="sm" variant="outline">{t('design_system.gallery.samples.scope.cancel')}</Button>
      </div>
    </div>
  )
}

export function DesignScopeModeExample() {
  return (
    <div className="grid w-full gap-gutter md:grid-cols-2">
      <DesignScope mode="light" className="rounded-card p-panel">
        <ScopeSample />
      </DesignScope>
      <DesignScope mode="dark" className="rounded-card p-panel">
        <ScopeSample />
      </DesignScope>
    </div>
  )
}

export function DesignScopeDensityExample() {
  return (
    <div className="grid w-full gap-gutter md:grid-cols-2">
      <DesignScope density="default">
        <ScopeSample />
      </DesignScope>
      <DesignScope density="compact">
        <ScopeSample />
      </DesignScope>
    </div>
  )
}

export function DesignScopeShapeExample() {
  const shapes: DesignScopeShape[] = ['default', 'round', 'sharp']
  return (
    <div className="grid w-full gap-gutter lg:grid-cols-3">
      {shapes.map((shape) => (
        <DesignScope key={shape} shape={shape}>
          <ScopeSample />
        </DesignScope>
      ))}
    </div>
  )
}

export function DesignScopeNestedExample() {
  const t = useT()
  return (
    <DesignScope mode="dark" shape="round" className="w-full rounded-card p-card">
      <div className="flex flex-col gap-gutter md:flex-row">
        <div className="flex-1">
          <ScopeSample />
        </div>
        <DesignScope mode="light" density="compact" className="rounded-card p-panel md:w-80">
          <p className="mb-3 text-xs text-muted-foreground">{t('design_system.gallery.samples.scope.nested')}</p>
          <ScopeSample />
        </DesignScope>
      </div>
    </DesignScope>
  )
}
