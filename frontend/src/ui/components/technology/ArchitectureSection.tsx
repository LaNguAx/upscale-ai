import { Layers, Target, BarChart3, GitBranch } from 'lucide-react';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { Separator } from '@/ui/shadcn/ui/separator';

const TOPICS = [
  {
    icon: Layers,
    title: 'Temporal Windows & the Baseline CNN',
    paragraphs: [
      'The core idea behind video super-resolution is that a single degraded frame does not contain enough information to fully reconstruct a high-quality version. However, neighboring frames in a video sequence often capture slightly different perspectives of the same scene due to motion. By processing multiple consecutive frames together, the model can combine complementary information and produce a result that surpasses what any single frame could provide.',
      'Our baseline architecture takes a fixed-size window of consecutive frames (e.g. 7 frames) and concatenates them along the channel dimension. A standard RGB frame has 3 channels — so 7 frames produce a 21-channel input tensor. This tensor is passed through a series of convolutional layers that learn to extract and merge spatio-temporal features across all frames simultaneously.'
    ],
    highlights: [
      { label: 'Input', value: 'N consecutive frames concatenated (N × 3 channels)' },
      { label: 'Output', value: 'Single enhanced central frame at target resolution' },
      { label: 'Alignment', value: 'Implicit — learned by convolutions, no explicit optical flow' },
      { label: 'Upscaling', value: 'Sub-pixel convolution layers for 2× or 4× super-resolution' }
    ]
  },
  {
    icon: Target,
    title: 'Loss Functions',
    paragraphs: [
      'The loss function defines what "good output" means to the model during training. We use a combination of two complementary objectives that together balance pixel-level accuracy with perceptual quality.',
      'L1 Loss (Mean Absolute Error) is the primary reconstruction loss. It measures the average absolute difference between each predicted pixel and the corresponding ground-truth pixel. L1 was chosen over L2 (Mean Squared Error) because L2 over-penalizes large errors, which causes the model to produce blurry "average" outputs. L1 preserves sharper edges and finer details.',
      'Perceptual Loss is an optional secondary objective. Instead of comparing pixels directly, it passes both the predicted and ground-truth frames through a pretrained classification network (e.g. VGG) and compares their internal feature representations. This encourages the output to match the high-level visual structure, texture, and style of the ground truth — capturing qualities that pixel-wise metrics miss.'
    ],
    highlights: [
      { label: 'L1 Loss', value: 'Pixel-wise accuracy, sharp edges, stable training' },
      { label: 'Perceptual Loss', value: 'Texture fidelity, structural similarity, visual realism' },
      { label: 'Composition', value: 'Weighted sum — weights are tunable per experiment' },
      { label: 'Temporal', value: 'Implicitly enforced via consecutive-frame training pairs' }
    ]
  },
  {
    icon: BarChart3,
    title: 'Evaluation Metrics',
    paragraphs: [
      'Measuring the quality of restored video is a multi-faceted problem. A frame can be pixel-perfect but perceptually flat, or slightly imprecise per-pixel but visually stunning. We use multiple complementary metrics to capture different aspects of quality.',
      'PSNR (Peak Signal-to-Noise Ratio) measures the ratio between the maximum possible signal power and the power of the distortion. Higher PSNR generally indicates better reconstruction fidelity, but it does not always correlate with human perception — two images with identical PSNR can look very different to the eye.',
      'SSIM (Structural Similarity Index) goes beyond pixel differences by measuring changes in structural information, luminance, and contrast. It better reflects perceived image quality by considering how humans perceive visual patterns. We also use perceptual metrics based on deep feature distances for a more holistic assessment. All quantitative metrics are complemented by visual inspection on real legacy footage.'
    ],
    highlights: [
      { label: 'PSNR', value: 'Pixel-level fidelity (dB scale, higher is better)' },
      { label: 'SSIM', value: 'Structural similarity (0–1 scale, closer to 1 is better)' },
      { label: 'Perceptual', value: 'Deep feature distance from pretrained networks' },
      { label: 'Visual', value: 'Human inspection on real degraded footage' }
    ]
  },
  {
    icon: GitBranch,
    title: 'Training Strategy',
    paragraphs: [
      'A fundamental challenge in video restoration is the absence of paired real-world data. There is no dataset of the same video captured in both "old, degraded" and "pristine" quality. To solve this, we use a supervised learning approach with synthetically generated training pairs.',
      'We start with high-quality video clips (1080p or higher, minimal compression, clean recordings) as ground truth. Each clip is then passed through a synthetic degradation pipeline that simulates the artifacts found in real legacy footage: spatial downscaling (1080p → 360p/480p), Gaussian noise injection, mild blur (focus and motion), and aggressive compression (low-bitrate H.264 encoding). The degraded version becomes the input, and the original becomes the target.',
      'The model is trained on short clips of consecutive frames (not full videos) to keep memory requirements manageable. The dataset is split into training, validation, and test subsets. The validation set guides hyperparameter tuning and model selection, while the test set is reserved for final evaluation — never seen during training. This ensures results are not overfit to the training distribution.'
    ],
    highlights: [
      { label: 'Approach', value: 'Supervised learning with synthetic degradation pairs' },
      { label: 'Degradations', value: 'Downscaling + noise + blur + compression artifacts' },
      { label: 'Data split', value: 'Train / validation / test — strict separation' },
      { label: 'Generalization', value: 'Tested on real legacy footage not seen during training' }
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
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground">
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
                      <p className="mt-0.5 text-sm text-foreground">{h.value}</p>
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
