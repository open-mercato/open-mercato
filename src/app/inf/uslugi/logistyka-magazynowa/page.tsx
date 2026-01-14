import Link from 'next/link'
import { Header } from '../../components/Header'
import { Footer } from '../../components/Footer'

const storageOptions = [
  'Magazynowanie krotko- i dlugoterminowe (od dni do lat)',
  'Obiekty z kontrola klimatu dla zywnosci, farmaceutykow i towarow specjalistycznych',
]

const inventoryManagement = [
  'Kontrola jakosci i ilosci przy odbiorze',
  'Kompletacja zamowien i konsolidacja',
  'Regularne sledzenie stanow magazynowych',
  'Operacje cross-docking',
]

const logisticsSupport = [
  'Uslugi pakowania i przepakowywania',
  'Etykietowanie zgodne z miedzynarodowymi standardami',
  'Konsolidacja przesylek dla redukcji kosztow',
  'Dystrybucja do klientow koncowych',
]

const benefits = [
  {
    title: 'Elastycznosc',
    description: 'Eliminacja duzych inwestycji kapitalowych przy jednoczesnym umozliwieniu skalowalnej przestrzeni magazynowej.',
  },
  {
    title: 'Profesjonalna infrastruktura',
    description: 'Zaawansowane systemy i technologie dla efektywnosci operacyjnej.',
  },
  {
    title: 'Skalowalnosc',
    description: 'Latwe dostosowywanie pojemnosci magazynowej w oparciu o rzeczywiste zapotrzebowanie.',
  },
]

const relatedServices = [
  { href: '/inf/uslugi/transport-morski', label: 'Fracht morski (kontenerowy i drobnicowy)' },
  { href: '/inf/uslugi/transport-lotniczy', label: 'Ladunek lotniczy (door-to-door i uslugi lotniskowe)' },
  { href: '/inf/uslugi/transport-drogowy', label: 'Transport drogowy (FTL/LTL w calej Europie)' },
  { href: '/inf/uslugi/transport-kolejowy', label: 'Fracht kolejowy (polaczenia Azja-Europa)' },
]

export default function WarehouseLogisticsPage() {
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
            <span className="text-[#1B4D5C]">Logistyka magazynowa</span>
          </div>
          <div className="mt-8 max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Logistyka magazynowa
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              INF Shipping oferuje kompleksowe uslugi logistyki magazynowej zintegrowane z multimodalnymi rozwiazaniami transportowymi, w tym przechowywanie, zarzadzanie zapasami i uslugi dystrybucji.
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

      {/* Services Grid */}
      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Glowne kategorie uslug
          </h2>

          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {/* Storage Options */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <div className="mb-4 inline-flex rounded-lg bg-[#1B4D5C]/10 p-3 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Opcje przechowywania</h3>
              <ul className="mt-4 space-y-3">
                {storageOptions.map((option, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600 text-sm">{option}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Inventory Management */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <div className="mb-4 inline-flex rounded-lg bg-[#1B4D5C]/10 p-3 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Zarzadzanie zapasami</h3>
              <ul className="mt-4 space-y-3">
                {inventoryManagement.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600 text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Logistics Support */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <div className="mb-4 inline-flex rounded-lg bg-[#1B4D5C]/10 p-3 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Wsparcie logistyczne</h3>
              <ul className="mt-4 space-y-3">
                {logisticsSupport.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600 text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Glowne korzysci
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {benefits.map((benefit, index) => (
              <div key={index} className="rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                  <span className="text-xl font-bold">{index + 1}</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{benefit.title}</h3>
                <p className="mt-2 text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Related Services */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Powiazane uslugi transportowe
          </h2>
          <p className="mt-4 text-gray-600">
            Strona promuje rowniez powiazane opcje transportu:
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            {relatedServices.map((service) => (
              <Link
                key={service.href}
                href={service.href}
                className="rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 transition-all hover:border-[#1B4D5C]/30 hover:text-[#1B4D5C]"
              >
                {service.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-r from-[#1B4D5C] to-[#164250] px-8 py-16 text-center sm:px-16">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Potrzebujesz uslug magazynowych?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Skontaktuj sie z nami, aby omowic Twoje potrzeby magazynowe i logistyczne.
            </p>
            <div className="mt-8">
              <Link
                href="/inf/free-quote"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Odbierz darmowa wycene
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
