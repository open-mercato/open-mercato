import { TopBar } from './components/TopBar'
import { Header } from './components/Header'
import { HeroSection } from './components/HeroSection'
import { ServicesSection } from './components/ServicesSection'
import { WhyChooseUsSection } from './components/WhyChooseUsSection'
import { TaglineSection } from './components/TaglineSection'
import { TestimonialsSection } from './components/TestimonialsSection'
import { WorkWithUsSection } from './components/WorkWithUsSection'
import { CTASection } from './components/CTASection'
import { Footer } from './components/Footer'

export default function INFHome() {
  return (
    <main className="min-h-svh w-full bg-white">
      <TopBar />
      <Header />
      <HeroSection />
      <ServicesSection />
      <WhyChooseUsSection />
      <TaglineSection />
      <TestimonialsSection />
      <WorkWithUsSection />
      <CTASection />
      <Footer />
    </main>
  )
}
