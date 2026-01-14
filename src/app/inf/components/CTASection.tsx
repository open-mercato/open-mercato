'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export function CTASection() {
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  return (
    <section className="bg-[#EB5C2E] py-16">
      <div className="mx-auto max-w-[1440px] px-6 text-center">
        <h2 className="font-sans text-[36px] font-medium leading-tight text-white">
          {translate('cta.mainTitle', 'Transport and logistics services at the lowest price')}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl font-sans text-lg text-white/80">
          {translate('cta.mainDescription', 'Regain peace of mind regarding the transport of your goods. Contact us and get a free quote today!')}
        </p>
        <div className="mt-8">
          <Link
            href="/inf/free-quote"
            className="inline-flex items-center rounded-[6px] border-2 border-white bg-white px-[26px] py-[17px] font-sans text-[15px] font-semibold text-[#EB5C2E] transition-colors hover:bg-[#14363C] hover:border-[#14363C] hover:text-white"
          >
            {translate('cta.mainButton', 'Get free quote')}
          </Link>
        </div>
      </div>
    </section>
  )
}
