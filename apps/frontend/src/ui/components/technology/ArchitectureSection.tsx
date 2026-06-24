import { Layers, Target, BarChart3, GitBranch } from 'lucide-react';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { Separator } from '@/ui/shadcn/ui/separator';

const TOPICS = [
  {
    icon: Layers,
    title: 'BasicVSR: Flow-Aligned Recurrent Propagation',
    paragraphs: [
      'The core idea is that a single degraded frame does not contain enough information to fully reconstruct a high-quality version, but neighboring frames captured slightly different perspectives of the same scene due to motion. The model exploits this by propagating information between frames rather than processing each one in isolation.',
      'A shared CNN extracts features from every frame in a 15-frame window. SPyNet, a pretrained optical-flow network, then estimates the motion between each pair of neighboring frames. Features are propagated through the window twice — backward and forward — and at each step the previous propagated state is warped using the estimated flow before merging with the current frame, so moving content stays spatially aligned instead of blurring together.'
    ],
    highlights: [
      {
        label: 'Input',
        value: '15-frame window, processed frame-by-frame (not concatenated)'
      },
      {
        label: 'Output',
        value: 'One enhanced frame per window, taken from its center'
      },
      {
        label: 'Alignment',
        value: 'Explicit — optical flow from a pretrained SPyNet, fine-tuned at a lower learning rate'
      },
      {
        label: 'Upscaling',
        value: 'Pixel-shuffle convolutions, fixed at 4x'
      }
    ]
  },
  {
    icon: Target,
    title: 'Loss Functions',
    paragraphs: [
      'The loss function defines what "good output" means to the model during training. We use a weighted combination of three complementary objectives.',
      'Charbonnier loss (a smooth, differentiable approximation of L1) is the primary reconstruction term — it penalizes pixel-wise error while staying more stable near zero than plain L1. A Sobel edge loss compares image gradients between prediction and target, pushing the model toward sharper edges. A VGG19-based perceptual loss compares deep feature activations of both images, encouraging realistic texture beyond what pixel-wise terms capture.',
      'The three terms are combined with fixed weights (Charbonnier 1.0, edge 0.05, perceptual 0.1) into a single training objective.'
    ],
    highlights: [
      {
        label: 'Charbonnier',
        value: 'Primary reconstruction loss, weight 1.0'
      },
      {
        label: 'Sobel edge loss',
        value: 'Gradient-matching for sharper edges, weight 0.05'
      },
      {
        label: 'VGG19 perceptual',
        value: 'Deep feature matching for realistic texture, weight 0.1'
      },
      {
        label: 'Composition',
        value: 'Fixed-weight weighted sum of all three terms'
      }
    ]
  },
  {
    icon: BarChart3,
    title: 'Evaluation Metrics',
    paragraphs: [
      'Measuring the quality of restored video is a multi-faceted problem. A frame can be pixel-perfect but perceptually flat, or slightly imprecise per-pixel but visually convincing. We track multiple metrics and always compare against a bicubic-upscaling baseline rather than looking at absolute numbers alone.',
      'PSNR (Peak Signal-to-Noise Ratio) measures pixel-level reconstruction fidelity in dB — higher is better, though it does not always correlate with human perception.',
      'SSIM (Structural Similarity Index) measures structural and luminance similarity, better reflecting perceived quality. Both metrics are reported as the model’s gain over a simple bicubic upscale of the same input, which is the baseline the model needs to beat to justify the extra cost.'
    ],
    highlights: [
      {
        label: 'PSNR',
        value: 'Pixel-level fidelity (dB scale, higher is better)'
      },
      {
        label: 'SSIM',
        value: 'Structural similarity (0–1 scale, closer to 1 is better)'
      },
      {
        label: 'Baseline',
        value: 'Bicubic upscale of the same input frame'
      },
      {
        label: 'Reported',
        value: 'PSNR/SSIM gain over the bicubic baseline'
      }
    ]
  },
  {
    icon: GitBranch,
    title: 'Training Strategy',
    paragraphs: [
      'A fundamental challenge in video restoration is the absence of paired real-world data — there is no dataset of the same footage in both "old, degraded" and "pristine" quality. To solve this, we use supervised learning with synthetically generated training pairs.',
      'We start with high-quality video clips as ground truth. Each frame is passed through a randomized degradation function before downscaling: Gaussian blur (60% chance), motion blur (15% chance), Gaussian noise (60% chance, varying intensity), and JPEG re-compression (60% chance, varying quality) — each applied independently and randomly per frame. The degraded, downscaled version becomes the model input; the original becomes the target.',
      'The model trains on short 15-frame clips (not full videos) with a 64px patch size to keep memory requirements manageable. Data is split into training, validation, and test sets with strict separation — the test set is only used for final evaluation, never during training or model selection.'
    ],
    highlights: [
      {
        label: 'Approach',
        value: 'Supervised learning with synthetic degradation pairs'
      },
      {
        label: 'Degradations',
        value: 'Randomized blur, motion blur, noise, and JPEG compression'
      },
      {
        label: 'Data split',
        value: 'Train / validation / test — strict separation'
      },
      {
        label: 'Note',
        value: 'Degradation is training-time only — inference upscales the input as-is, with no separate denoise/deblur step'
      }
    ]
  }
];

export function ArchitectureSection() {
  return (
    <section className="section-alt py-20 sm:py-24">
      <PageContainer className="max-w-3xl">
        <SectionHeading
          title="Architecture Deep Dive"
          subtitle="A closer look at the design decisions, training strategy, and evaluation methodology behind the model."
        />
        <div className="space-y-8">
          {TOPICS.map((topic) => (
            <Card key={topic.title}>
              <CardHeader className="flex-row items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <topic.icon className="size-5" />
                </div>
                <CardTitle className="text-lg">{topic.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {topic.paragraphs.map((p, i) => (
                  <p
                    key={i}
                    className="text-sm leading-relaxed text-muted-foreground"
                  >
                    {p}
                  </p>
                ))}
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2">
                  {topic.highlights.map((h) => (
                    <div key={h.label}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                        {h.label}
                      </p>
                      <p className="mt-0.5 text-sm text-foreground">
                        {h.value}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
