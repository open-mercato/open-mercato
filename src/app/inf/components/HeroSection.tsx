'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export function HeroSection() {
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  return (
    <section className="relative flex w-full flex-col-reverse bg-[#1F5058] lg:flex-row">
      {/* Left content - 36% width with 7.5% margin */}
      <div className="relative z-10 flex w-full flex-col px-5 pb-5 pt-[100px] lg:ml-6 lg:w-[40%] lg:pb-5 lg:pr-5 lg:pt-[100px]">
        <h1 className="font-sans text-[32px] font-bold leading-[40px] text-white lg:text-[3rem] lg:leading-[60px]">
          {translate('hero.title', 'Transport services')}
        </h1>
        <h2 className="mt-2 font-sans text-[28px] font-medium leading-[36px] text-white lg:text-[2.375rem] lg:leading-[46px]">
          {translate('hero.subtitle', 'unlimited possibilities')}{' '}
          <span className="relative inline-block">
            {translate('hero.subtitleHighlight', 'at the lowest prices')}
            <svg
              className="absolute -bottom-1 left-0 h-2 w-full"
              viewBox="0 0 200 8"
              fill="none"
              preserveAspectRatio="none"
            >
              <path d="M2 6C50 2 150 2 198 6" stroke="#EB5C2E" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
        </h2>
        <p className="mt-6 max-w-[460px] font-sans text-[15px] font-normal leading-6 text-white/80">
          {translate('hero.description', 'We deliver logistics solutions that strengthen your business.')}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Link
            href="/inf/uslugi"
            className="inline-flex items-center rounded-[6px] border-2 border-white bg-[#1F5058] px-[26px] py-[21px] font-sans text-[15px] font-semibold text-white transition-colors hover:border-[#EB5C2E] hover:bg-[#EB5C2E]"
          >
            {translate('hero.checkOffer', 'Check our offer')}
          </Link>
          <Link
            href="/inf/free-quote"
            className="font-sans text-[15px] font-medium text-white transition-colors hover:text-[#EB5C2E]"
          >
            {translate('hero.getFreeQuote', 'Get free quote')}
          </Link>
        </div>
      </div>

      {/* Right video - 60% width */}
      <div className="relative aspect-video w-full lg:aspect-auto lg:w-[60%]">
        <video
          autoPlay
          loop
          muted
          playsInline
          poster="/fms/hero-video-poster.jpg"
          className="h-full min-h-[300px] w-full object-cover lg:min-h-[500px]"
        >
          <source src="/fms/hero-video-original.mp4" type="video/mp4" />
        </video>
      </div>
    </section>
  )
}
