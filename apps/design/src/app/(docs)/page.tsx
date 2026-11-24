import { IntroContent } from '@/components/IntroContent'
import { entriesForGroup } from '@/lib/manifest'

export default function IntroductionPage() {
  return (
    <IntroContent
      counts={{
        foundations: entriesForGroup('foundations').length,
        components: entriesForGroup('components').length,
        blocks: entriesForGroup('blocks').length,
      }}
    />
  )
}
