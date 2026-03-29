import { useState, useCallback } from 'react';
import { useParams, Navigate } from 'react-router';
import { PageContainer } from '@/ui/components/PageContainer';
import { VideoUploadForm } from '@/ui/components/product/VideoUploadForm';
import { JobStatusPanel } from '@/ui/components/product/JobStatusPanel';
import { JobResultPanel } from '@/ui/components/product/JobResultPanel';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Badge } from '@/ui/shadcn/ui/badge';
import { Button } from '@/ui/shadcn/ui/button';
import { useUploadVideoMutation } from '@/store/api/upscale.api';
import { useAppDispatch } from '@/store/hooks';
import { addJob } from '@/store/slices/job.slice';
import { getProductBySlug } from '@/consts/products';
import { Crown, RotateCcw, Construction } from 'lucide-react';
import { Card, CardContent } from '@/ui/shadcn/ui/card';

type PageState = 'idle' | 'uploading' | 'processing' | 'completed' | 'failed';

export function Product() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getProductBySlug(slug) : undefined;

  const [pageState, setPageState] = useState<PageState>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadVideo] = useUploadVideoMutation();
  const dispatch = useAppDispatch();

  const handleUpload = useCallback(
    async (file: File) => {
      setPageState('uploading');
      setUploadError(null);

      try {
        const formData = new FormData();
        formData.append('video', file);
        if (slug) formData.append('product', slug);

        const result = await uploadVideo(formData).unwrap();
        setJobId(result.jobId);
        setPageState('processing');
        dispatch(
          addJob({
            jobId: result.jobId,
            filename: file.name,
            submittedAt: new Date().toISOString()
          })
        );
      } catch {
        setUploadError('Failed to upload video. Please check your connection and try again.');
        setPageState('idle');
      }
    },
    [uploadVideo, dispatch, slug]
  );

  const handleReset = useCallback(() => {
    setPageState('idle');
    setJobId(null);
    setUploadError(null);
  }, []);

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
                We're currently focused on building the Video Upscaler. This tool is next on our
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
              <VideoUploadForm onUpload={handleUpload} isUploading={pageState === 'uploading'} />
            )}

            {pageState === 'processing' && jobId && (
              <JobStatusPanel
                jobId={jobId}
                onCompleted={() => setPageState('completed')}
                onFailed={() => setPageState('failed')}
              />
            )}

            {pageState === 'completed' && jobId && (
              <JobResultPanel jobId={jobId} onReset={handleReset} />
            )}

            {pageState === 'failed' && (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    Video processing failed. This may be due to an unsupported format or a server
                    issue.
                  </AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleReset} className="w-full">
                  <RotateCcw className="size-4" data-icon="inline-start" />
                  Try Again
                </Button>
              </div>
            )}
          </>
        )}
      </PageContainer>
    </section>
  );
}
