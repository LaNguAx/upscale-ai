import { ZoomIn, Eraser, Film, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const FEATURES: Feature[] = [
  {
    icon: ZoomIn,
    title: 'Super-Resolution',
    description:
      'Increase video resolution up to 4x using deep learning, recovering fine details lost in low-quality recordings.'
  },
  {
    icon: Eraser,
    title: 'Noise Reduction',
    description:
      'Remove grain, sensor noise, and analog artifacts that degrade legacy video content.'
  },
  {
    icon: Film,
    title: 'Temporal Consistency',
    description:
      'Maintain smooth, flicker-free motion across frames by leveraging temporal windows of consecutive frames.'
  },
  {
    icon: Wand2,
    title: 'Artifact Removal',
    description:
      'Eliminate compression blocks, ringing effects, and encoding artifacts for a cleaner viewing experience.'
  }
];
