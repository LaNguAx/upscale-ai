import { useState, useCallback } from 'react';
import { useParams, Navigate } from 'react-router';
import { PageContainer } from '@/ui/components/PageContainer';
import { VideoUploadForm } from '@/ui/components/product/VideoUploadForm';
import { JobStatusPanel } from '@/ui/components/product/JobStatusPanel';
import { JobResultPanel } from '@/ui/components/product/JobResultPanel';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Badge } from '@/ui/shadcn/ui/badge';
import { Button } from '@/ui/shadcn/ui/button';
import { useUploadVideoMutation, useCancelJobMutation } from '@/store/api/upscale.api';
import { useAppDispatch } from '@/store/hooks';
import { addJob } from '@/store/slices/job.slice';
import { getProductBySlug } from '@/consts/products';
import { Crown, RotateCcw, Construction } from 'lucide-react';
import { Card, CardContent } from '@/ui/shadcn/ui/card';

type PageState = 'idle' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled';

type UploadMutationError =
  | {
      error?: string;
      // The backend returns RFC 7807 ProblemDetails (`detail`/`title`); the
      // legacy `message` shape is kept as a fallback.
      data?: { detail?: string; title?: string; message?: string | string[] };
      status?: string | number;
    }
  | undefined;

function getApiErrorMessage(error: unknown): string | null {
  const typedError = error as UploadMutationError;
  if (!typedError) {
    return null;
  }

  if (typeof typedError.error === 'string' && typedError.error.length > 0) {
    return typedError.error;
  }

  const { detail, title, message } = typedError.data ?? {};
  if (typeof detail === 'string' && detail.length > 0) {
    return detail;
  }
  if (Array.isArray(message)) {
    return message.join(', ');
  }
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  if (typeof title === 'string' && title.length > 0) {
    return title;
  }

  return null;
}

function getUploadErrorMessage(error: unknown): string {
  return (
    getApiErrorMessage(error) ??
    'Failed to upload video. Please check your connection and try again.'
  );
}

function getCancelErrorMessage(error: unknown): string {
  return getApiErrorMessage(error) ?? 'Failed to stop upscaling. Please try again.';
}

export function Product() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getProductBySlug(slug) : undefined;

  const [pageState, setPageState] = useState<PageState>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [uploadVideo] = useUploadVideoMutation();
  const [cancelJob] = useCancelJobMutation();
  const dispatch = useAppDispatch();

  const handleUpload = useCallback(
    async (file: File) => {
      setPageState('uploading');
      setUploadProgress(0);
      setUploadError(null);
      setProcessingError(null);
      setIsStopping(false);

      try {
        const formData = new FormData();
        formData.append('video', file);
        if (slug) formData.append('product', slug);

        const result = await uploadVideo({
          formData,
          onProgress: (p) => { setUploadProgress(p); }
        }).unwrap();

        setJobId(result.jobId);
        setPageState('processing');
        dispatch(
          addJob({
            jobId: result.jobId,
            filename: file.name,
            submittedAt: new Date().toISOString()
          })
        );
      } catch (error) {
        setUploadError(getUploadErrorMessage(error));
        setPageState('idle');
      }
    },
    [uploadVideo, dispatch, slug]
  );

  const handleReset = useCallback(() => {
    setPageState('idle');
    setJobId(null);
    setUploadProgress(0);
    setUploadError(null);
    setProcessingError(null);
    setIsStopping(false);
  }, []);

  const handleStopUpscaling = useCallback(async () => {
    if (!jobId) return;
    try {
      setIsStopping(true);
      await cancelJob(jobId).unwrap();
    } catch (error) {
      setProcessingError(getCancelErrorMessage(error));
      setPageState('failed');
      setIsStopping(false);
    }
  }, [cancelJob, jobId]);

  if (!product) {
    return <Navigate to="/products/upscaler" replace />;
  }

  const Icon = product.icon;

  return (
    <section className="py-16 sm:py-20">
      <PageContainer className="max-w-2xl">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            {product.isPro ? <Crown className="size-7 text-amber-500" /> : <Icon className="size-7" />}
          </div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {product.name}
            </h1>
            {product.isPro && (
              <Badge className="bg-gradient-to-r from-amber-500 to-amber-600 text-white border-0 text-xs font-bold">
                PRO
              </Badge>
            )}
          </div>
          <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
            {product.description}
          </p>
        </div>

        {product.isWip ? (
          <Card className="border-dashed border-2 border-border">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Construction className="size-6" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Coming Soon</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                We&apos;re currently focused on building the Video Upscaler. This tool is next on our
                roadmap and will be available soon.
              </p>
              <Button asChild variant="outline" className="mt-6">
                <a href="/products/upscaler">Try Video Upscaler</a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {uploadError && (
              <Alert variant="destructive" className="mb-6">
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            )}

            {(pageState === 'idle' || pageState === 'uploading') && (
              <VideoUploadForm
                onUpload={(file) => {
                  void handleUpload(file);
                }}
                isUploading={pageState === 'uploading'}
                uploadProgress={uploadProgress}
              />
            )}

            {pageState === 'processing' && jobId && (
              <JobStatusPanel
                jobId={jobId}
                onCompleted={() => { setPageState('completed'); }}
                onCancelled={(reason) => {
                  setProcessingError(reason ?? 'Upscaling cancelled by user.');
                  setPageState('cancelled');
                  setIsStopping(false);
                }}
                onFailed={(reason) => {
                  setProcessingError(reason ?? 'AI inference failed. Please try again.');
                  setPageState('failed');
                  setIsStopping(false);
                }}
                onStop={() => {
                  void handleStopUpscaling();
                }}
                isStopping={isStopping}
              />
            )}

            {pageState === 'completed' && jobId && (
              <JobResultPanel jobId={jobId} onReset={handleReset} />
            )}

            {pageState === 'failed' && (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    {processingError ??
                      'Video processing failed. This may be due to an unsupported format or a server issue.'}
                  </AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleReset} className="w-full">
                  <RotateCcw className="size-4" data-icon="inline-start" />
                  Try Again
                </Button>
              </div>
            )}

            {pageState === 'cancelled' && (
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    {processingError ?? 'Upscaling cancelled successfully.'}
                  </AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleReset} className="w-full">
                  <RotateCcw className="size-4" data-icon="inline-start" />
                  Upload New Video
                </Button>
              </div>
            )}
          </>
        )}
      </PageContainer>
    </section>
  );
}
