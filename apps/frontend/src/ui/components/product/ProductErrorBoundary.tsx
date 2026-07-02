import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/ui/shadcn/ui/alert';
import { Button } from '@/ui/shadcn/ui/button';

interface ProductErrorBoundaryProps {
  children: ReactNode;
  onReset: () => void;
}

interface ProductErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render crashes in the product flow so a bad media state can never
 * white-screen the whole app — the user gets an alert and a clean reset.
 */
export class ProductErrorBoundary extends Component<
  ProductErrorBoundaryProps,
  ProductErrorBoundaryState
> {
  override state: ProductErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ProductErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Product view crashed', error, info.componentStack);
  }

  private readonly handleReset = () => {
    this.setState({ hasError: false });
    this.props.onReset();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              Something went wrong while displaying this view. Your video and
              job are unaffected.
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={this.handleReset} className="w-full">
            <RotateCcw className="size-4" data-icon="inline-start" />
            Start Over
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
