import { Link } from 'react-router';
import { ArrowRight, Upload, Cpu, Download, Sparkles, Film, Zap } from 'lucide-react';
import { Button } from '@/ui/shadcn/ui/button';

const features = [
  {
    icon: Upload,
    title: 'Upload Your Video',
    description: 'Drag and drop any low-quality or legacy video. Supports MP4, AVI, MKV, MOV, and more.'
  },
  {
    icon: Cpu,
    title: 'AI Enhancement',
    description:
      'Our deep learning model processes each frame using temporal context for superior restoration quality.'
  },
  {
    icon: Download,
    title: 'Download Enhanced',
    description: 'Get your upscaled, restored video in high quality. Preview before downloading.'
  }
];

const capabilities = [
  { icon: Sparkles, label: 'Super Resolution', desc: 'Up to 4x spatial upscaling' },
  { icon: Film, label: 'Video Restoration', desc: 'Noise reduction & artifact removal' },
  { icon: Zap, label: 'Temporal Coherence', desc: 'Frame-to-frame consistency' }
];

export function Home() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-primary/5 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary mb-6">
            <Sparkles className="size-3.5" />
            Deep Learning Video Restoration
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground leading-tight">
            Restore your videos
            <br />
            with{' '}
            <span className="bg-gradient-to-r from-primary via-purple-500 to-primary bg-clip-text text-transparent">
              AI precision
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed">
            Transform degraded, low-resolution videos into sharp, high-quality content. Our neural
            network leverages temporal information across frames for results that classical methods
            cannot achieve.
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <Button asChild size="lg" className="gap-2 text-base px-8">
              <Link to="/upload">
                Start Upscaling
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 text-base px-8">
              <Link to="/dashboard">View Dashboard</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground">How it works</h2>
          <p className="mt-2 text-muted-foreground">Three simple steps to enhance your videos</p>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {features.map((feature, i) => (
            <div key={feature.title} className="relative flex flex-col items-center text-center gap-4">
              {i < features.length - 1 && (
                <div className="absolute top-8 left-[60%] hidden w-[calc(100%-20%)] border-t border-dashed border-border sm:block" />
              )}
              <div className="relative flex size-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
                <feature.icon className="size-7 text-primary" />
                <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  {i + 1}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">AI-Powered Capabilities</h2>
            <p className="mt-2 text-muted-foreground">
              Built on deep learning research for video restoration
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {capabilities.map((cap) => (
              <div
                key={cap.label}
                className="rounded-xl border border-border bg-card p-6 flex flex-col gap-3 transition-colors hover:border-primary/30"
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <cap.icon className="size-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{cap.label}</h3>
                <p className="text-sm text-muted-foreground">{cap.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold text-foreground">Ready to enhance your videos?</h2>
        <p className="mt-3 text-muted-foreground">Upload a video and see the difference AI makes.</p>
        <Button asChild size="lg" className="mt-8 gap-2 text-base px-8">
          <Link to="/upload">
            <Upload className="size-4" />
            Upload Video
          </Link>
        </Button>
      </section>
    </div>
  );
}
