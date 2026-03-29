import { PageContainer } from '@/ui/components/PageContainer';
import { Brain } from 'lucide-react';

export function TechHero() {
  return (
    <section className="hero-gradient py-16 sm:py-20">
      <PageContainer className="max-w-4xl text-center">
        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Brain className="size-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          The Technology Behind Upscale AI
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          A deep learning pipeline that processes video frame-by-frame using temporal windows,
          restoring quality while maintaining smooth, consistent motion.
        </p>
        <div className="mx-auto mt-8 grid max-w-3xl gap-6 text-left sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/60 p-4 backdrop-blur-sm">
            <p className="text-2xl font-bold text-primary">5 Stages</p>
            <p className="mt-1 text-sm text-muted-foreground">
              End-to-end pipeline from raw video input to enhanced output
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4 backdrop-blur-sm">
            <p className="text-2xl font-bold text-primary">3–7 Frames</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Temporal window size for exploiting inter-frame information
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4 backdrop-blur-sm">
            <p className="text-2xl font-bold text-primary">Up to 4x</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Spatial upscaling from 360p/480p to Full HD and beyond
            </p>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
