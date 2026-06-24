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
          BasicVSR with a SPyNet optical-flow estimator: a bidirectional
          recurrent network that explicitly aligns neighboring frames before
          upscaling, instead of just stacking frames into a CNN.
        </p>
        <div className="mx-auto mt-8 grid max-w-3xl gap-6 text-left sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/60 p-4 backdrop-blur-sm">
            <p className="text-2xl font-bold text-primary">6 Stages</p>
            <p className="mt-1 text-sm text-muted-foreground">
              End-to-end pipeline from raw video input to enhanced output
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4 backdrop-blur-sm">
            <p className="text-2xl font-bold text-primary">15-Frame Window</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sliding window centered on each output frame, with explicit
              optical-flow alignment between frames
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4 backdrop-blur-sm">
            <p className="text-2xl font-bold text-primary">Fixed 4x</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Spatial upscaling, e.g. 480p input to 1080p+ output
            </p>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
