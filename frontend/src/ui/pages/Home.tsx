import { HeroSection } from '@/ui/components/home/HeroSection';
import { FeaturesSection } from '@/ui/components/home/FeaturesSection';
import { HowItWorksSection } from '@/ui/components/home/HowItWorksSection';
import { CTASection } from '@/ui/components/home/CTASection';

export function Home() {
  return (
    <>
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <CTASection />
    </>
  );
}
