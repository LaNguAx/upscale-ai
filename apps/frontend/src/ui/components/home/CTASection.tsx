import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/ui/shadcn/ui/button';

export function CTASection() {
  return (
    <section className="bg-primary py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-primary-foreground sm:text-3xl">
          Ready to enhance your videos?
        </h2>
        <p className="mt-4 text-base text-primary-foreground/80">
          Upload your video and let our deep learning model do the rest. No technical expertise
          required.
        </p>
        <Button
          asChild
          variant="secondary"
          size="lg"
          className="mt-8"
        >
          <Link to="/products">
            Get Started
            <ArrowRight className="size-4" data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
