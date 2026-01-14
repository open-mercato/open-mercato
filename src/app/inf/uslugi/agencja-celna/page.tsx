import Link from 'next/link'
import { Header } from '../../components/Header'
import { Footer } from '../../components/Footer'

const benefits = [
  {
    title: 'Profesjonalna ekspertyza',
    description: 'Specjalisci posiadaja rozlegle doswiadczenie w zarzadzaniu roznymi procedurami celnymi, minimalizujac ryzyko bledow i zapewniajac szybkie, zgodne odprawy.',
  },
  {
    title: 'Redukcja ryzyka finansowego',
    description: 'Precyzyjne przygotowanie dokumentacji i wlasciwa klasyfikacja towarow pomagaja unikac nieoczekiwanych kosztow, kar i nieprzewidzianych oplat.',
  },
  {
    title: 'Rozwiazania specjalistyczne',
    description: 'Agencja zapewnia poradnictwo dla zlozonych przesylek obejmujacych towary niebezpieczne, zwierzeta i swieze produkty spozywcze, zapewniajac zgodnosc z obowiazujacymi przepisami.',
  },
]

const customsClearance = [
  'Przygotowywanie i skladanie deklaracji',
  'Obliczanie cel i VAT',
  'Reprezentacja klienta przed organami celnymi',
  'Uzyskiwanie niezbednych pozwolen i certyfikatow (fitosanitarne, weterynaryjne)',
]

const customsConsultation = [
  'Pomoc w okreslaniu kodow taryfowych',
  'Dostep do specjalnych procedur (sklady celne, procedury uproszczone, odprawa czasowa)',
  'Poradnictwo w zakresie taryf preferencyjnych i umow handlowych',
]

const additionalServices = [
  {
    title: 'Reprezentacja klienta',
    description: 'Agencja obsluguje inspekcje celne, spory klasyfikacyjne i inne kwestie proceduralne, chroniac interesy klienta przez caly proces rozwiazywania.',
  },
  {
    title: 'Dokumentacja i zarzadzanie logistyka',
    description: 'Koordynacja przesylek i monitorowanie transportu, kompleksowa obsluga dokumentacji, nadzor nad zgodnascia z przepisami.',
  },
  {
    title: 'Przyspieszone procedury celne',
    description: 'Wsparcie dla certyfikacji AEO (Autoryzowany Operator Ekonomiczny), umozliwiajace uproszczone i przyspieszone procedury celne.',
  },
]

export default function CustomsAgencyPage() {
  return (
    <main className="min-h-svh w-full bg-white">
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-gray-200">
        <div
          className="pointer-events-none absolute right-[5%] top-[10%] h-[500px] w-[500px] rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle, rgba(27, 77, 92, 0.2) 0%, rgba(27, 77, 92, 0.1) 50%, transparent 70%)',
            filter: 'blur(60px)',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/inf/uslugi" className="hover:text-gray-900">Uslugi</Link>
            <span>/</span>
            <span className="text-[#1B4D5C]">Agencja celna</span>
          </div>
          <div className="mt-8 max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Uslugi agencji celnej
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              INF Shipping Solutions oferuje kompleksowe uslugi odprawy celnej na calym swiecie. Firma obsluguje wszystkie formalne procedury zwiazane z deklaracjami celnymi, w tym procedury standardowe, uproszczone i opcje odroczonego VAT.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/inf/free-quote"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Odbierz darmowa wycene
              </Link>
              <Link
                href="/inf/kontakt"
                className="inline-flex items-center rounded-full border-2 border-[#1B4D5C] px-6 py-3 text-base font-semibold text-[#1B4D5C] transition-colors hover:bg-[#1B4D5C] hover:text-white"
              >
                Skontaktuj sie
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Kluczowe korzysci z korzystania z agencji celnej
          </h2>
          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {benefits.map((benefit, index) => (
              <div key={index} className="rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{benefit.title}</h3>
                <p className="mt-2 text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Services */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Glowne uslugi
          </h2>

          <div className="mt-12 grid gap-12 lg:grid-cols-2">
            {/* Customs Clearance */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <h3 className="text-xl font-bold text-gray-900">Odprawa celna</h3>
              <ul className="mt-6 space-y-4">
                {customsClearance.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Customs Consultation */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <h3 className="text-xl font-bold text-gray-900">Konsultacje celne</h3>
              <ul className="mt-6 space-y-4">
                {customsConsultation.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Additional Services */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Dodatkowe uslugi
          </h2>
          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {additionalServices.map((service, index) => (
              <div key={index} className="rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30">
                <h3 className="text-lg font-semibold text-gray-900">{service.title}</h3>
                <p className="mt-2 text-gray-600">{service.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Related Services Info */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-2xl border border-[#1B4D5C]/30 bg-[#1B4D5C]/5 p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Kompleksowa obsluga</h3>
                <p className="mt-2 text-gray-600">
                  INF Shipping zapewnia rowniez transport morski, drogowy, kolejowy i lotniczy, plus logistyke magazynowa - wszystko zaprojektowane tak, aby usprawnic operacje handlu miedzynarodowego.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/inf/uslugi" className="text-[#E8754B] hover:underline">
                    Zobacz wszystkie uslugi
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-r from-[#1B4D5C] to-[#164250] px-8 py-16 text-center sm:px-16">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Potrzebujesz pomocy z odprawia celna?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Nasi eksperci celni pomoga Ci sprawnie przeprowadzic wszystkie formalnosci.
            </p>
            <div className="mt-8">
              <Link
                href="/inf/free-quote"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Skontaktuj sie z nami
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
