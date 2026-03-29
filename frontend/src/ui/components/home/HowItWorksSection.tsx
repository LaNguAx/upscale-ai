import { Upload, Cpu, Download, ArrowRight } from 'lucide-react';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';

const STEPS = [
  {
    icon: Upload,
    title: 'Upload Your Video',
    description:
      'Select a low-quality or legacy video file. We support MP4, AVI, MKV, MOV, and WebM formats up to 500 MB.'
  },
  {
    icon: Cpu,
    title: 'AI Processing',
    description:
      'Our CNN processes consecutive frames in temporal windows, leveraging motion cues and spatial features to enhance every frame.'
  },
  {
    icon: Download,
    title: 'Download Enhanced',
    description:
      'Preview the restored video and download it in high quality. Enjoy improved resolution, reduced noise, and cleaner details.'
  }
];

export function HowItWorksSection() {
  return (
    <section className="section-alt py-20 sm:py-24">
      <PageContainer>
        <SectionHeading
          title="How It Works"
          subtitle="Three simple steps to transform your video content."
        />
        <div className="grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="relative flex flex-col items-center text-center">
              <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <step.icon className="size-6" />
              </div>

              {index < STEPS.length - 1 && (
                <div className="absolute left-[calc(50%+2.5rem)] top-7 hidden text-border sm:block lg:left-[calc(50%+3rem)]">
                  <ArrowRight className="size-5" />
                </div>
              )}

              <span className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">
                Step {index + 1}
              </span>
              <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground max-w-xs">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
