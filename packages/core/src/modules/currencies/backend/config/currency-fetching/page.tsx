import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import CurrencyFetchingConfig from '../../../components/CurrencyFetchingConfig'

export default async function CurrencyFetchingPage() {
  const { t } = await resolveTranslations()

  return (
    <CurrencyFetchingConfig
      translations={{
        title: t('currencies.fetch.title'),
        enabled: t('currencies.fetch.enabled'),
        disabled: t('currencies.fetch.disabled'),
        syncTime: t('currencies.fetch.sync_time'),
        lastSync: t('currencies.fetch.last_sync'),
        lastSyncStatus: t('currencies.fetch.last_sync_status'),
        lastSyncCount: t('currencies.fetch.last_sync_count'),
        fetchNow: t('currencies.fetch.fetch_now'),
        syncSuccess: t('currencies.fetch.sync_success'),
        syncError: t('currencies.fetch.sync_error'),
        providerNbp: t('currencies.fetch.provider_nbp'),
        providerRaiffeisen: t('currencies.fetch.provider_raiffeisen'),
        loading: t('currencies.fetch.loading'),
        testConnection: t('currencies.fetch.test_connection'),
        baseCurrency: t('currencies.fetch.baseCurrency'),
      }}
    />
  )
}
