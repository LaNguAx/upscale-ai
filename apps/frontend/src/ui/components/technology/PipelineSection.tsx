import { FileVideo, Layers, Cpu, Grid3X3, Film, ArrowDown } from 'lucide-react';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';

const PIPELINE_STEPS = [
  {
    icon: FileVideo,
    title: 'Frame Extraction',
    description:
      'The input video is decomposed into a sequence of individual frames. This step converts the compressed video stream into raw image data that the neural network can process.',
    details: [
      'Preserves the original frame rate (e.g. 24fps, 30fps) and temporal ordering',
      'Handles common container formats: MP4, AVI, MKV, MOV, WebM',
      'Extracts frames as normalized tensor representations ready for GPU processing',
      'Stores metadata (resolution, duration, codec) for later video reconstruction'
    ]
  },
  {
    icon: Layers,
    title: 'Temporal Window Creation',
    description:
      'Rather than processing each frame in isolation, frames are grouped into overlapping sliding windows of 3–7 consecutive frames. This is a critical step that separates video super-resolution from single-image approaches.',
    details: [
      'A window centered on frame N includes frames [N-3, N-2, N-1, N, N+1, N+2, N+3] for a window size of 7',
      'Overlapping windows ensure every frame benefits from neighboring context',
      'Allows the model to detect motion, exploit temporal redundancy, and avoid flickering',
      'At video boundaries, frames are replicated to maintain consistent window sizes'
    ]
  },
  {
    icon: Cpu,
    title: 'CNN Enhancement',
    description:
      'Each temporal window is fed into a convolutional neural network (CNN). The consecutive frames are concatenated along the channel dimension — so instead of a single 3-channel RGB image, the network receives a multi-frame tensor (e.g. 21 channels for 7 RGB frames).',
    details: [
      'Convolutional layers extract spatio-temporal features across all frames simultaneously',
      'The network learns to align information between neighboring frames without explicit optical flow',
      'The output is a single enhanced frame — the central frame of the window — with improved resolution and reduced artifacts',
      'Optional 2x or 4x spatial upscaling via learned upsampling layers (sub-pixel convolution)'
    ]
  },
  {
    icon: Grid3X3,
    title: 'Frame Reconstruction',
    description:
      'As the sliding window moves across the video, enhanced frames are collected one by one. Each processed window contributes one restored central frame to the output sequence.',
    details: [
      'Frames are reordered to match the original temporal sequence',
      'Overlapping window processing ensures seamless transitions with no gaps',
      'Output frames maintain the same spatial alignment as the input, only at higher quality',
      'GPU acceleration enables processing hundreds of windows per minute'
    ]
  },
  {
    icon: Film,
    title: 'Video Assembly',
    description:
      'The final stage encodes all enhanced frames back into a playable video file. The output preserves the original temporal structure while delivering significantly improved visual quality.',
    details: [
      'Re-encodes frames using modern codecs (H.264/H.265) with quality-optimized settings',
      'Preserves original frame rate, duration, and aspect ratio',
      'Output resolution matches the upscaling factor (e.g. 480p input → 1080p output at 2x)',
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
          subtitle="From degraded input to enhanced output — every video passes through these five stages."
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
