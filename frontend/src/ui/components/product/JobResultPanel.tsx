import { useGetJobResultQuery } from '@/store/api/upscale.api';
import { Button } from '@/ui/shadcn/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/ui/card';
import { Skeleton } from '@/ui/shadcn/ui/skeleton';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Separator } from '@/ui/shadcn/ui/separator';
import { Download, RotateCcw } from 'lucide-react';
import { formatDuration } from '@/utils/format';

function downloadFile(url: string, filename: string) {
  fetch(url)
    .then((res) => res.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}

interface JobResultPanelProps {
  jobId: string;
  onReset: () => void;
}

export function JobResultPanel({ jobId, onReset }: JobResultPanelProps) {
  const { data: result, isLoading, error } = useGetJobResultQuery(jobId);
  const streamUrl = `${import.meta.env.VITE_API_BASE_URL}/upload/stream/${jobId}`;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !result) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>Unable to load the enhanced video. Please try again.</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onReset} className="w-full">
          <RotateCcw className="size-4" data-icon="inline-start" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Enhancement Complete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
          <video
            src={streamUrl}
            controls
            className="aspect-video w-full"
          />
        </div>

        {result.metadata && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Original</p>
                <p className="font-medium">{result.metadata.originalResolution}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Enhanced</p>
                <p className="font-medium">{result.metadata.outputResolution}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Duration</p>
                <p className="font-medium">{formatDuration(result.metadata.duration)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Processing Time</p>
                <p className="font-medium">{formatDuration(result.metadata.processingTime)}</p>
              </div>
            </div>
          </>
        )}

        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => downloadFile(streamUrl, result.outputFilename)}
          >
            <Download className="size-4" data-icon="inline-start" />
            Download Enhanced Video
          </Button>
          <Button variant="outline" onClick={onReset}>
            <RotateCcw className="size-4" data-icon="inline-start" />
            New Video
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
