import Link from 'next/link'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

const values = [
  {
    title: 'Zaufanie i relacje',
    description: 'Dlugoterminowe partnerstwa budowane na przejrzystosci i niezawodnosci, zapewniajace klientom poczucie bezpieczenstwa przez caly proces transportowy.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    title: 'Efektywnosc i elastycznosc',
    description: 'Rozwiazania zaprojektowane tak, aby maksymalizowac efektywnosc logistyki przy jednoczesnej minimalizacji kosztow i ryzyka transportowego.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    title: 'Innowacyjnosc w sluzbie klienta',
    description: 'Wdrazanie nowoczesnych technologii monitorowania i zarzadzania, ktore zapewniaja kontrole przesylki w czasie rzeczywistym.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    title: 'Zrownowazony rozwoj',
    description: 'Skupienie na odpowiedzialnosci za srodowisko i redukcji sladu weglowego w naszych operacjach.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
]

const benefits = [
  'Pelny spokoj i bezpieczenstwo podczas transportu',
  'Uslugi dostosowane do specyficznych potrzeb biznesu',
  'Transparentnosc sledzenia przesylek w czasie rzeczywistym',
  'Optymalizacja kosztow i efektywnosc procesow',
  'Globalny zasieg z niezawodna siecia partnerow',
  'Profesjonalne wsparcie 24/7',
]

const services = [
  { href: '/inf/uslugi/transport-morski', label: 'Transport morski' },
  { href: '/inf/uslugi/transport-drogowy', label: 'Transport drogowy' },
  { href: '/inf/uslugi/agencja-celna', label: 'Agencja celna' },
  { href: '/inf/uslugi/transport-kolejowy', label: 'Transport kolejowy' },
  { href: '/inf/uslugi/transport-lotniczy', label: 'Transport lotniczy' },
  { href: '/inf/uslugi/logistyka-magazynowa', label: 'Logistyka magazynowa' },
]

export default function AboutPage() {
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
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Zespol ekspertow, ktorzy zadba o Twoj transport
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              INF Shipping Solutions to zespol doswiadczonych specjalistow w dziedzinie logistyki i transportu miedzynarodowego. Laczymy wieloletnie doswiadczenie z nowoczesnymi technologiami, aby zapewnic naszym klientom najwyzszej jakosci uslugi.
            </p>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Nasze wartosci
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Fundamenty, na ktorych budujemy nasze relacje z klientami
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2">
            {values.map((value, index) => (
              <div
                key={index}
                className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30"
              >
                <div className="mb-4 inline-flex rounded-lg bg-[#1B4D5C]/10 p-3 text-[#1B4D5C]">
                  {value.icon}
                </div>
                <h3 className="text-xl font-semibold text-gray-900">
                  {value.title}
                </h3>
                <p className="mt-3 text-gray-600">
                  {value.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Korzysci ze wspolpracy z nami
              </h2>
              <p className="mt-4 text-lg text-gray-600">
                Wybierajac INF Shipping Solutions, zyskujesz partnera, ktory rozumie Twoje potrzeby i dostarcza rozwiazania na najwyzszym poziomie.
              </p>
            </div>

            <div className="space-y-4">
              {benefits.map((benefit, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-4 hover:border-[#1B4D5C]/30"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-gray-600">{benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Nasze uslugi
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Oferujemy kompleksowe rozwiazania transportowe i logistyczne
            </p>
          </div>

          <div className="mt-12 flex flex-wrap justify-center gap-4">
            {services.map((service) => (
              <Link
                key={service.href}
                href={service.href}
                className="rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-medium text-gray-600 transition-all hover:border-[#1B4D5C]/30 hover:text-[#1B4D5C]"
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
              Gotowy na wspolprace?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Skontaktuj sie z nami i dowiedz sie, jak mozemy pomoc w optymalizacji Twojej logistyki.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/inf/kontakt"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Skontaktuj sie
              </Link>
              <Link
                href="/inf/free-quote"
                className="inline-flex items-center rounded-full border-2 border-white px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white hover:text-[#1B4D5C]"
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
