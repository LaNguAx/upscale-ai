import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardHeader, CardTitle, CardDescription } from '@/ui/shadcn/ui/card';
import { Badge } from '@/ui/shadcn/ui/badge';

const STACK = [
  {
    name: 'Python',
    layer: 'AI',
    description:
      'Core language for the deep learning pipeline. Handles dataset preparation, synthetic degradation, model definition, training loops, and inference scripts.'
  },
  {
    name: 'PyTorch',
    layer: 'AI',
    description:
      'Deep learning framework for building and training the CNN restoration model. Provides GPU-accelerated tensor operations, autograd, and a rich ecosystem of pretrained models for perceptual loss.'
  },
  {
    name: 'NestJS',
    layer: 'Backend',
    description:
      'TypeScript backend framework handling video uploads, job queue management, inference orchestration, and RESTful API endpoints for the frontend.'
  },
  {
    name: 'React',
    layer: 'Frontend',
    description:
      'Frontend framework powering the web interface. Provides the upload flow, real-time job status polling, video preview, and download experience.'
  },
  {
    name: 'Redux Toolkit',
    layer: 'Frontend',
    description:
      'State management with RTK Query for backend API communication. Handles caching, automatic polling for job status, and optimistic updates.'
  },
  {
    name: 'Tailwind CSS',
    layer: 'Frontend',
    description:
      'Utility-first CSS framework for building a responsive, accessible UI with a consistent design system based on CSS custom properties.'
  }
];

const LAYER_COLORS: Record<string, string> = {
  AI: 'bg-purple-100 text-purple-700',
  Backend: 'bg-green-100 text-green-700',
  Frontend: 'bg-blue-100 text-blue-700'
};

export function TechStackSection() {
  return (
    <section className="py-20 sm:py-24">
      <PageContainer>
        <SectionHeading
          title="Tech Stack"
          subtitle="The tools and frameworks powering each layer of the Upscale AI system."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STACK.map((item) => (
            <Card key={item.name}>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{item.name}</CardTitle>
                  <Badge variant="secondary" className={LAYER_COLORS[item.layer]}>
                    {item.layer}
                  </Badge>
                </div>
                <CardDescription className="text-sm leading-relaxed">
                  {item.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
