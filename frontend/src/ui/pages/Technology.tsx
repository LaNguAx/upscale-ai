import { TechHero } from '@/ui/components/technology/TechHero';
import { PipelineSection } from '@/ui/components/technology/PipelineSection';
import { ArchitectureSection } from '@/ui/components/technology/ArchitectureSection';
import { TechStackSection } from '@/ui/components/technology/TechStackSection';

export function Technology() {
  return (
    <>
      <TechHero />
      <PipelineSection />
      <ArchitectureSection />
      <TechStackSection />
    </>
  );
}
