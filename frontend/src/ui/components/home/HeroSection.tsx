import { Link } from 'react-router';
import { Sparkles, Play } from 'lucide-react';
import { Button } from '@/ui/shadcn/ui/button';
import { PageContainer } from '@/ui/components/PageContainer';

export function HeroSection() {
  return (
    <section className="hero-gradient relative overflow-hidden py-20 sm:py-28 lg:py-36">
      <PageContainer>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-1.5 text-sm font-medium text-primary backdrop-blur-sm">
              <Sparkles className="size-4" />
              AI-Powered Video Restoration
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Restore &amp; Upscale Your Videos{' '}
              <span className="text-primary">with AI</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Breathe new life into old films, archival footage, and legacy recordings. Our deep
              learning pipeline enhances resolution, removes noise, and eliminates artifacts while
              preserving temporal consistency.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Button asChild size="lg">
                <Link to="/products/pro">
                  <Play className="size-4" data-icon="inline-start" />
                  Try It Now
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/technology">Learn More</Link>
              </Button>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-lg lg:mx-0">
            <div className="aspect-video overflow-hidden rounded-xl border border-border bg-background shadow-xl">
              <div className="grid h-full grid-cols-2">
                <div className="relative flex items-center justify-center bg-muted/50">
                  <div className="absolute left-3 top-3 rounded-md bg-foreground/80 px-2 py-0.5 text-xs font-medium text-background">
                    Before
                  </div>
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <div className="grid grid-cols-3 gap-1 opacity-40">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <div key={i} className="size-4 rounded-sm bg-muted-foreground/30 sm:size-5" />
                      ))}
                    </div>
                    <span className="text-xs">Low Quality</span>
                  </div>
                </div>
                <div className="relative flex items-center justify-center bg-primary/5">
                  <div className="absolute right-3 top-3 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                    After
                  </div>
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <div className="grid grid-cols-3 gap-1">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <div key={i} className="size-4 rounded-sm bg-primary/25 sm:size-5" />
                      ))}
                    </div>
                    <span className="text-xs font-medium">Enhanced</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-3 -right-3 -z-10 h-full w-full rounded-xl bg-primary/10" />
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
