'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export function WorkWithUsSection() {
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  return (
    <section className="bg-white py-[100px]">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Left - Text content */}
          <div>
            <h2 className="font-sans text-[40px] font-medium leading-[50px] text-[#EB5C2E] lg:text-[50px] lg:leading-[60px]">
              {translate('workWithUs.title', 'Work with us')}
            </h2>
            <p className="mt-6 font-sans text-base leading-relaxed text-[#14363C]">
              {translate('workWithUs.description1', 'We focus on cooperation with people full of passion who believe that the path they follow leads to the very top.')}
            </p>
            <p className="mt-4 font-sans text-base leading-relaxed text-[#14363C]">
              {translate('workWithUs.description2', 'The best companies are created by the best employees, which is why recruitment at INF is always open – we are waiting for you!')}
            </p>
            <div className="mt-8">
              <Link
                href="/inf/kontakt"
                className="inline-flex items-center rounded-[6px] bg-[#EB5C2E] px-[26px] py-[17px] font-sans text-[15px] font-semibold text-white transition-colors hover:bg-[#14363C]"
              >
                {translate('workWithUs.button', 'Apply now')}
              </Link>
            </div>
          </div>

          {/* Right - Photo grid */}
          <div className="grid grid-cols-3 gap-2">
            {/* Row 1 */}
            <div className="relative aspect-[3/4] overflow-hidden rounded-[6px]">
              <div className="absolute inset-0 bg-gradient-to-br from-[#1F5058] to-[#14363C]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-16 w-16 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
            </div>
            <div className="relative aspect-[3/4] overflow-hidden rounded-[6px]">
              <div className="absolute inset-0 bg-gradient-to-br from-[#1F5058] to-[#14363C]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-16 w-16 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
            </div>
            <div className="relative aspect-[3/4] overflow-hidden rounded-[6px]">
              <div className="absolute inset-0 bg-gradient-to-br from-[#1F5058] to-[#14363C]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-16 w-16 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
            </div>

            {/* Row 2 - spanning */}
            <div className="relative col-span-2 aspect-[2/1] overflow-hidden rounded-[6px]">
              <div className="absolute inset-0 bg-[#14363C]" />
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <Image
                  src="/fms/inf-logo.svg"
                  alt="INF Logo"
                  width={200}
                  height={80}
                  className="h-auto w-3/4 brightness-0 invert"
                />
              </div>
            </div>
            <div className="relative aspect-[3/4] overflow-hidden rounded-[6px]">
              <div className="absolute inset-0 bg-gradient-to-br from-[#1F5058] to-[#14363C]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-16 w-16 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
