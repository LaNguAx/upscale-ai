import { PageContainer } from '@/ui/components/PageContainer';

export function ProjectSection() {
  return (
    <section className="hero-gradient py-16 sm:py-20">
      <PageContainer className="max-w-3xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          About the Project
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Upscale AI is a B.Sc. Computer Science final project specializing in Deep Learning,
          developed at The College of Management &ndash; Academic Studies. The project explores
          deep-learning-based video restoration and super-resolution, bridging the gap between
          academic research and practical, end-to-end enhancement systems.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Our goal is to restore legacy and archival video content &mdash; old films, documentaries,
          and historical recordings &mdash; by training convolutional neural networks on
          synthetically degraded data and evaluating their ability to generalize to real-world
          footage.
        </p>
      </PageContainer>
    </section>
  );
}
