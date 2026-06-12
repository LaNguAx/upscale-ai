import { FEATURES } from '@/consts/features';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardHeader, CardTitle, CardDescription } from '@/ui/shadcn/ui/card';

export function FeaturesSection() {
  return (
    <section className="py-20 sm:py-24">
      <PageContainer>
        <SectionHeading
          title="What Upscale AI Does"
          subtitle="Our deep learning models tackle the most common degradations found in legacy video content."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <Card
              key={feature.title}
              className="group transition-shadow hover:shadow-md"
            >
              <CardHeader>
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  <feature.icon className="size-5" />
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
