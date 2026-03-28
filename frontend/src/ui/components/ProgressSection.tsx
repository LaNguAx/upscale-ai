import { Progress } from '@/ui/shadcn/ui/progress';
import type { JobStatus } from '@/types/upscale.types';

const steps = [
  { label: 'Uploading', range: [0, 0] },
  { label: 'Extracting frames', range: [1, 10] },
  { label: 'AI Enhancement', range: [11, 90] },
  { label: 'Reconstructing', range: [91, 99] },
  { label: 'Complete', range: [100, 100] }
] as const;

function getCurrentStep(progress: number): string {
  for (const step of steps) {
    if (progress >= step.range[0] && progress <= step.range[1]) {
      return step.label;
    }
  }
  return 'Processing';
}

interface ProgressSectionProps {
  progress: number;
  status: JobStatus;
}

export function ProgressSection({ progress, status }: ProgressSectionProps) {
  const currentStep = status === 'completed' ? 'Complete' : getCurrentStep(progress);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{currentStep}</span>
        <span className="font-mono font-medium text-foreground">{progress}%</span>
      </div>
      <Progress value={progress} className="h-2" />
      <div className="flex justify-between">
        {steps.slice(1, -1).map((step) => (
          <span
            key={step.label}
            className={`text-xs ${
              progress >= step.range[0] ? 'text-primary' : 'text-muted-foreground/50'
            }`}
          >
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}
