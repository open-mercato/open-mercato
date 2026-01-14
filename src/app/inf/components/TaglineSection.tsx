'use client'

import Image from 'next/image'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export function TaglineSection() {
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  return (
    <section className="relative overflow-hidden bg-white py-[100px]">
      <div className="mx-auto max-w-[1440px] px-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="font-sans text-[32px] font-medium leading-[40px] text-[#EB5C2E] lg:text-[50px] lg:leading-[60px]">
            {translate('tagline.title', 'We create domestic and international transport for you')}{' '}
            <span className="text-[#14363C]">{translate('tagline.titleHighlight', 'without borders')}</span>
          </h2>
        </div>

        {/* Bullet points */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6 lg:gap-12">
          <div className="flex items-center gap-2">
            <div className="h-[7px] w-[7px] rounded-full bg-[#EB5C2E]" />
            <span className="font-sans text-[16px] font-medium uppercase tracking-wide text-[#14363C]">
              {translate('tagline.fast', 'Fast')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-[7px] w-[7px] rounded-full bg-[#EB5C2E]" />
            <span className="font-sans text-[16px] font-medium uppercase tracking-wide text-[#14363C]">
              {translate('tagline.convenient', 'Convenient')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-[7px] w-[7px] rounded-full bg-[#EB5C2E]" />
            <span className="font-sans text-[16px] font-medium uppercase tracking-wide text-[#14363C]">
              {translate('tagline.onYourTerms', 'On your terms')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-[7px] w-[7px] rounded-full bg-[#EB5C2E]" />
            <span className="font-sans text-[16px] font-medium uppercase tracking-wide text-[#14363C]">
              {translate('tagline.alwaysAvailable', '24/7')}
            </span>
          </div>
        </div>

        {/* World map with tagline */}
        <div className="relative mt-12 flex min-h-[350px] items-center lg:min-h-[400px]">
          {/* World Map Background Image */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Image
              src="/fms/world-map-bg.png"
              alt="World map"
              width={900}
              height={400}
              className="h-auto w-full max-w-4xl object-contain"
            />
          </div>

          {/* Tagline text */}
          <div className="relative ml-auto max-w-md text-right lg:max-w-lg">
            <p className="font-sans text-[36px] font-bold italic leading-[44px] text-[#EB5C2E] lg:text-[56px] lg:leading-[64px]">
              {translate('tagline.slogan1', 'Unlimited possibilities')}
              <br />
              {translate('tagline.slogan2', 'at the lowest prices')}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
