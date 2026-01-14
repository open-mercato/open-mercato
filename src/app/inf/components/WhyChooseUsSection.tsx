'use client'

import Image from 'next/image'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

const benefitIcons = [
  // Comfort icon
  <svg key="comfort" className="h-[60px] w-[60px]" viewBox="0 0 60 60" fill="none" stroke="#EB5C2E" strokeWidth="2">
    <rect x="10" y="15" width="40" height="35" rx="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 15V10M20 10h20" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M22 32l6 6 10-12" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  // Trust icon
  <svg key="trust" className="h-[60px] w-[60px]" viewBox="0 0 60 60" fill="none" stroke="#EB5C2E" strokeWidth="2">
    <path d="M30 10L10 20v15c0 12 20 20 20 20s20-8 20-20V20L30 10z" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M22 32l6 6 10-12" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  // Individual icon
  <svg key="individual" className="h-[60px] w-[60px]" viewBox="0 0 60 60" fill="none" stroke="#EB5C2E" strokeWidth="2">
    <circle cx="30" cy="20" r="8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 28v22M20 40h20" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="20" cy="40" r="3" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="40" cy="40" r="3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  // Technology icon
  <svg key="technology" className="h-[60px] w-[60px]" viewBox="0 0 60 60" fill="none" stroke="#EB5C2E" strokeWidth="2">
    <circle cx="30" cy="30" r="18" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="30" cy="30" r="8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 12v5M30 43v5M12 30h5M43 30h5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  // Global icon
  <svg key="global" className="h-[60px] w-[60px]" viewBox="0 0 60 60" fill="none" stroke="#EB5C2E" strokeWidth="2">
    <circle cx="30" cy="30" r="20" strokeLinecap="round" strokeLinejoin="round"/>
    <ellipse cx="30" cy="30" rx="8" ry="20" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 30h40M14 20h32M14 40h32" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  // Ecology icon
  <svg key="ecology" className="h-[60px] w-[60px]" viewBox="0 0 60 60" fill="none" stroke="#EB5C2E" strokeWidth="2">
    <path d="M30 50V30" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 30c-10 0-15-10-15-20 15 0 15 10 15 20z" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 30c10 0 15-10 15-20-15 0-15 10-15 20z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
]

export function WhyChooseUsSection() {
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  return (
    <section className="bg-[#14363C] py-[100px]">
      <div className="mx-auto max-w-[1440px] px-6">
        {/* Header - Two columns */}
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="font-sans text-[36px] font-medium leading-[44px] text-[#EB5C2E] lg:text-[50px] lg:leading-[60px]">
              {translate('whyChooseUs.title', 'Why')} <span className="text-[#EB5C2E]">{translate('whyChooseUs.titleHighlight', 'INF Shipping Solutions')}</span> {translate('whyChooseUs.titleEnd', 'is the best choice for your business?')}
            </h2>
          </div>
          <div className="flex flex-col justify-center">
            <p className="font-sans text-lg font-medium text-white">
              {translate('whyChooseUs.subtitle', 'Because we will be a partner you can rely on in any situation.')}
            </p>
            <p className="mt-4 font-sans text-base text-white/80">
              {translate('whyChooseUs.description', 'We combine years of experience with modern solutions, and our freight forwarding services meet the highest international standards. Want to learn more and see why you should choose us?')}
            </p>
            <p className="mt-6 font-sans text-lg font-semibold text-white">
              {translate('whyChooseUs.infIs', 'INF Shipping Solutions is:')}
            </p>
          </div>
        </div>

        {/* Benefits Grid with Images */}
        <div className="mt-16 grid gap-[2px] lg:grid-cols-4">
          {/* Row 1 */}
          <div className="bg-[#1F5058] p-8">
            <h3 className="font-sans text-[20px] font-medium leading-[26px] text-[#EB5C2E]">
              {translate('whyChooseUs.benefits.comfort.title', 'Full comfort and security')}
            </h3>
            <p className="mt-4 font-sans text-[14px] font-semibold leading-relaxed text-white">
              {translate('whyChooseUs.benefits.comfort.description1', 'After placing an order, you can breathe easy – your transport is in good hands.')}
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.comfort.description2', 'We guarantee effective delivery, without the need for constant supervision.')}
            </p>
          </div>

          <div className="relative hidden aspect-square lg:block">
            <Image
              src="/fms/team-meeting-small.jpg"
              alt="Team meeting"
              fill
              className="object-cover"
            />
          </div>

          <div className="bg-[#1F5058] p-8">
            <h3 className="font-sans text-[20px] font-medium leading-[26px] text-[#EB5C2E]">
              {translate('whyChooseUs.benefits.trust.title', 'Trust and experience')}
            </h3>
            <p className="mt-4 font-sans text-[14px] font-semibold leading-relaxed text-white">
              {translate('whyChooseUs.benefits.trust.description1', 'Trust is built through effectiveness. We build it through solid and timely deliveries.')}
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.trust.description2', 'Every transport is a priority for us.')}
            </p>
          </div>

          <div className="bg-[#1F5058] p-8">
            <h3 className="font-sans text-[20px] font-medium leading-[26px] text-[#EB5C2E]">
              {translate('whyChooseUs.benefits.individual.title', 'Transport services with individual approach')}
            </h3>
            <p className="mt-4 font-sans text-[14px] font-semibold leading-relaxed text-white">
              {translate('whyChooseUs.benefits.individual.description1', 'Every business is different, which is why we focus on solutions tailored to your unique needs.')}
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.individual.description2', 'We\'ll create a plan that meets your most demanding expectations.')}
            </p>
          </div>

          {/* Row 2 */}
          <div className="bg-[#1F5058] p-8">
            <div className="mb-4">{benefitIcons[3]}</div>
            <h3 className="font-sans text-[20px] font-medium leading-[26px] text-[#EB5C2E]">
              {translate('whyChooseUs.benefits.technology.title', 'Modern technology')}
            </h3>
            <p className="mt-4 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.technology.description1', 'Thanks to advanced shipment tracking systems, you have full control over your goods transport in real time.')}
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.technology.description2', 'Our logistics is based on innovative tools.')}
            </p>
          </div>

          <div className="bg-[#1F5058] p-8">
            <div className="mb-4">{benefitIcons[4]}</div>
            <h3 className="font-sans text-[20px] font-medium leading-[26px] text-[#EB5C2E]">
              {translate('whyChooseUs.benefits.global.title', 'Global freight transport')}
            </h3>
            <p className="mt-4 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.global.description1', 'INF Shipping Solutions operates worldwide.')}
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.global.description2', 'Our strength is an extensive partner network.')}
            </p>
          </div>

          <div className="bg-[#1F5058] p-8">
            <div className="mb-4">{benefitIcons[5]}</div>
            <h3 className="font-sans text-[20px] font-medium leading-[26px] text-[#EB5C2E]">
              {translate('whyChooseUs.benefits.ecology.title', 'Ecology and sustainable development')}
            </h3>
            <p className="mt-4 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.ecology.description1', 'We believe that responsibility for the future of our planet rests on all of us.')}
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-white/80">
              {translate('whyChooseUs.benefits.ecology.description2', 'Our transport solutions meet the highest environmental standards.')}
            </p>
          </div>

          <div className="relative hidden aspect-square lg:block">
            <Image
              src="/fms/team-working.jpg"
              alt="Team working"
              fill
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
