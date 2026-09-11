import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { KeyStats } from "@/components/KeyStats";
import { Solutions } from "@/components/Solutions";
import { AesRegion } from "@/components/AesRegion";
import { Method } from "@/components/Method";
import { Partners } from "@/components/Partners";
import { ContactSection } from "@/components/ContactSection";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <main className="relative overflow-x-clip bg-ink-950">
      <Navbar />
      <Hero />
      <KeyStats />
      <Solutions />
      <AesRegion />
      <Method />
      <Partners />
      <ContactSection />
      <Footer />
    </main>
  );
}
