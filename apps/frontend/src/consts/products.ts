import { ZoomIn, Eraser, Focus, Wand2, Crown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ProductDefinition {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  icon: LucideIcon;
  isPro?: boolean;
  isWip?: boolean;
}

export const PRODUCTS: ProductDefinition[] = [
  {
    slug: 'upscaler',
    name: 'Video Upscaler',
    shortName: 'Upscaler',
    description:
      'Increase video resolution up to 4x. Recover fine spatial details lost in low-resolution recordings using deep learning super-resolution.',
    icon: ZoomIn
  },
  {
    slug: 'denoise',
    name: 'Noise Reducer',
    shortName: 'Denoise',
    description:
      'Remove grain, sensor noise, and analog artifacts from legacy video content while preserving texture and detail.',
    icon: Eraser,
    isWip: true
  },
  {
    slug: 'deblur',
    name: 'Blur Fix',
    shortName: 'Deblur',
    description:
      'Correct focus issues and motion blur. Sharpen soft footage to reveal details hidden by optical and motion degradation.',
    icon: Focus,
    isWip: true
  },
  {
    slug: 'artifacts',
    name: 'Artifact Cleaner',
    shortName: 'Artifacts',
    description:
      'Eliminate compression blocks, ringing effects, and encoding artifacts introduced by aggressive video compression.',
    icon: Wand2,
    isWip: true
  },
  {
    slug: 'pro',
    name: 'Upscale Pro',
    shortName: 'Pro',
    description:
      'The complete restoration pipeline. Combines super-resolution, denoising, deblurring, and artifact removal in a single pass for maximum quality.',
    icon: Crown,
    isPro: true
  }
];

export function getProductBySlug(slug: string): ProductDefinition | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}
