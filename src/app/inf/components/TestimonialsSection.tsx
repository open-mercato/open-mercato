'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

const QuoteIcon = () => (
  <svg className="h-[40px] w-[50px]" viewBox="0 0 50 40" fill="none">
    <path
      d="M10 30C10 35 14 38 19 38C24 38 28 34 28 29C28 24 24 20 19 20C18 20 17 20.2 16 20.5C17 15 21 10 27 8L25 3C16 6 10 14 10 24V30Z"
      fill="#EB5C2E"
    />
    <path
      d="M32 30C32 35 36 38 41 38C46 38 50 34 50 29C50 24 46 20 41 20C40 20 39 20.2 38 20.5C39 15 43 10 49 8L47 3C38 6 32 14 32 24V30Z"
      fill="#EB5C2E"
    />
  </svg>
)

export function TestimonialsSection() {
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  const testimonials = [
    {
      nameKey: 'testimonials.items.0.name',
      companyKey: 'testimonials.items.0.company',
      contentKey: 'testimonials.items.0.content',
      nameFallback: 'Beata Tymczewska',
      companyFallback: 'MultiMasz',
      contentFallback: 'INF Shipping Solutions is a guarantee of safety and professionalism.',
    },
    {
      nameKey: 'testimonials.items.1.name',
      companyKey: 'testimonials.items.1.company',
      contentKey: 'testimonials.items.1.content',
      nameFallback: 'Paulina Kita',
      companyFallback: 'TitanX',
      contentFallback: 'INF impresses with excellent organization and care for the customer.',
    },
    {
      nameKey: 'testimonials.items.2.name',
      companyKey: 'testimonials.items.2.company',
      contentKey: 'testimonials.items.2.content',
      nameFallback: 'Mei Yang',
      companyFallback: 'Elim',
      contentFallback: 'Thanks to INF Shipping Solutions, our export to the Far East runs smoothly.',
    },
  ]

  return (
    <>
      <section className="bg-white py-[100px]">
        <div className="mx-auto max-w-[1440px] px-6">
          {/* Header */}
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-sans text-[40px] font-medium leading-[50px] text-[#EB5C2E] lg:text-[50px] lg:leading-[60px]">
              {translate('testimonials.title', 'What do our clients say?')}
            </h2>
            <p className="mt-6 font-sans text-xl font-semibold text-[#14363C]">
              {translate('testimonials.subtitle', 'You are not and never will be just another row in our spreadsheet!')}
            </p>
            <p className="mt-4 font-sans text-base text-[#14363C]">
              {translate('testimonials.description', 'We focus on partner relationships! We care about the continuous growth of your business, lower logistics costs, and above all, the peace of mind you gain from transparent terms and a convenient transport management panel.')}
            </p>
          </div>

          {/* Testimonials Grid */}
          <div className="mt-16 grid gap-[22px] lg:grid-cols-3">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="rounded-[6px] bg-[#F7F7F7] p-8">
                <div className="flex items-start justify-between">
                  <h3 className="font-sans text-[18px] font-semibold text-[#14363C]">
                    {translate(testimonial.nameKey, testimonial.nameFallback)}
                  </h3>
                  <QuoteIcon />
                </div>
                <p className="mt-6 font-sans text-[14px] italic leading-relaxed text-[#14363C]">
                  {translate(testimonial.contentKey, testimonial.contentFallback)}
                </p>
                <div className="mt-8">
                  <p className="font-sans text-[14px] font-medium text-[#14363C]/60">
                    {translate(testimonial.companyKey, testimonial.companyFallback)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Bar */}
      <section className="bg-[#14363C] py-12">
        <div className="mx-auto max-w-[1440px] px-6">
          <div className="flex flex-col items-center justify-between gap-6 lg:flex-row">
            <div>
              <h3 className="font-sans text-[24px] font-medium text-[#EB5C2E] lg:text-[28px]">
                {translate('cta.title', 'Join our satisfied customers')}
              </h3>
              <p className="mt-2 font-sans text-base text-white/80">
                {translate('cta.description', 'Let\'s talk about your next transport. See for yourself how our cooperation can look.')}
              </p>
            </div>
            <Link
              href="/inf/free-quote"
              className="shrink-0 rounded-[6px] bg-[#EB5C2E] px-[26px] py-[17px] font-sans text-[15px] font-semibold text-white transition-colors hover:bg-[#d4522a]"
            >
              {translate('cta.button', 'Get a quote for your next transport')}
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
