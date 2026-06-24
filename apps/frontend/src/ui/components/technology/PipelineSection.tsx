import {
  FileVideo,
  Layers,
  Waypoints,
  Repeat,
  Grid3X3,
  Film,
  ArrowDown
} from 'lucide-react';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';

const PIPELINE_STEPS = [
  {
    icon: FileVideo,
    title: 'Frame Extraction & Resize',
    description:
      'The input video is decoded frame-by-frame with OpenCV (falling back to an ffmpeg transcode if the container is not directly decodable). All frames are loaded into memory before processing.',
    details: [
      'Preserves the original frame rate and temporal ordering',
      'Handles common container formats: MP4, AVI, MKV, MOV, WebM',
      'Frames taller than the configured max height are downscaled (aspect ratio preserved) to keep inference within GPU memory limits',
      'The model always upscales the input as-is — there is no separate denoising or artifact-removal stage'
    ]
  },
  {
    icon: Layers,
    title: 'Sliding 15-Frame Window',
    description:
      'Rather than transforming the whole video in one pass, every output frame is produced from its own 15-frame window centered on it. This is what lets the model exploit motion between frames instead of upscaling each one in isolation.',
    details: [
      'A window centered on frame N covers frames [N-7 .. N+7]',
      'Near the start/end of the video, the window is padded by repeating the boundary frame',
      'Each window is run independently through the full network — only the center frame’s output is kept',
      'This per-frame windowing is what allows progress reporting and mid-job cancellation'
    ]
  },
  {
    icon: Waypoints,
    title: 'Feature Extraction & Optical Flow',
    description:
      'Each frame in the window is passed through a shared convolutional feature extractor. In parallel, SPyNet — a pretrained spatial-pyramid network — estimates the optical flow between every pair of neighboring frames in both directions.',
    details: [
      'SPyNet weights are pretrained, then fine-tuned at a lower learning rate during training',
      'Flow is estimated explicitly, not learned implicitly by the main network — this is the key difference from single-image super-resolution',
      'The estimated flow is later used to warp propagated features so they stay spatially aligned with the current frame'
    ]
  },
  {
    icon: Repeat,
    title: 'Bidirectional Recurrent Propagation',
    description:
      'Features flow through the window twice: once backward (last frame to first) and once forward (first to last). At each step, the previous propagated state is warped using the optical flow before being merged with the current frame’s features through residual blocks.',
    details: [
      'Backward and forward propagation each use their own stack of residual blocks',
      'Warping with explicit flow keeps moving objects aligned across frames instead of blurring them together',
      'This recurrent, flow-aligned design is what BasicVSR uses instead of channel-concatenating frames into a single CNN'
    ]
  },
  {
    icon: Grid3X3,
    title: 'Fusion & 4x Upsampling',
    description:
      'For the window’s center frame, the forward and backward propagated features are fused and passed through a pixel-shuffle upsampler that increases spatial resolution by a fixed factor of 4x.',
    details: [
      'Fusion combines both propagation directions through residual blocks before upsampling',
      'Pixel-shuffle convolutions perform the learned upscaling in two 2x stages',
      'The scale factor is fixed at training time — it is not configurable per request'
    ]
  },
  {
    icon: Film,
    title: 'Video Assembly',
    description:
      'As each output frame is produced, it is written directly to the result video at the input frame rate and resolution multiplied by the upscale factor.',
    details: [
      'Frames are written in original temporal order as they complete',
      'Output resolution is exactly 4x the (possibly resized) input resolution',
      'The resulting file is ready for immediate playback and download'
    ]
  }
];

export function PipelineSection() {
  return (
    <section className="py-20 sm:py-24">
      <PageContainer className="max-w-3xl">
        <SectionHeading
          title="End-to-End Pipeline"
          subtitle="From low-resolution input to enhanced output — every video passes through these six stages."
        />
        <div className="space-y-4">
          {PIPELINE_STEPS.map((step, index) => (
            <div key={step.title}>
              <Card>
                <CardHeader className="flex-row items-start gap-4 pb-2">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <step.icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">
                      <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-primary">
                        Stage {index + 1}
                      </span>
                      {step.title}
                    </CardTitle>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="pl-18 pt-0">
                  <ul className="space-y-1.5 border-l-2 border-primary/15 pl-4">
                    {step.details.map((detail) => (
                      <li
                        key={detail}
                        className="text-sm leading-relaxed text-muted-foreground"
                      >
                        {detail}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              {index < PIPELINE_STEPS.length - 1 && (
                <div className="flex justify-center py-1.5 text-border">
                  <ArrowDown className="size-4" />
                </div>
              )}
            </div>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
