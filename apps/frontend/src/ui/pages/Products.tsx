import { Link } from 'react-router';
import { ArrowRight, Crown } from 'lucide-react';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardHeader, CardTitle, CardDescription } from '@/ui/shadcn/ui/card';
import { Badge } from '@/ui/shadcn/ui/badge';
import { Button } from '@/ui/shadcn/ui/button';
import { PRODUCTS } from '@/consts/products';
import { cn } from '@/ui/shadcn/lib/utils';

export function Products() {
  const freeProducts = PRODUCTS.filter((p) => !p.isPro);
  const proProduct = PRODUCTS.find((p) => p.isPro);

  return (
    <>
      <section className="hero-gradient py-16 sm:py-20">
        <PageContainer className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Our Products
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Choose the right tool for your video restoration needs, or go all-in with Upscale Pro.
          </p>
        </PageContainer>
      </section>

      <section className="py-16 sm:py-20">
        <PageContainer>
          <SectionHeading
            title="Individual Tools"
            subtitle="Each tool targets a specific type of video degradation."
          />
          <div className="grid gap-6 sm:grid-cols-2">
            {freeProducts.map((product) => (
              <Link key={product.slug} to={`/products/${product.slug}`} className="group">
                <Card
                  className={cn(
                    'h-full transition-all hover:shadow-md hover:border-primary/30',
                    product.isWip && 'opacity-70'
                  )}
                >
                  <CardHeader>
                    <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                      <product.icon className="size-5" />
                    </div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {product.name}
                      {product.isWip ? (
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          Coming Soon
                        </Badge>
                      ) : (
                        <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      {product.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </PageContainer>
      </section>

      {proProduct && (
        <section className="py-16 sm:py-20">
          <PageContainer className="max-w-3xl">
            <Card
              className={cn(
                'relative overflow-hidden border-2 border-amber-500/30',
                'bg-gradient-to-br from-amber-50/50 via-background to-amber-50/30'
              )}
            >
              <div className="absolute right-0 top-0 h-32 w-32 bg-gradient-to-bl from-amber-500/10 to-transparent" />
              <CardHeader className="items-center text-center p-8 sm:p-10">
                <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg">
                  <Crown className="size-8" />
                </div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-2xl sm:text-3xl">{proProduct.name}</CardTitle>
                  <Badge className="bg-gradient-to-r from-amber-500 to-amber-600 text-white border-0 text-xs font-bold">
                    PRO
                  </Badge>
                </div>
                <CardDescription className="mt-3 max-w-lg text-base leading-relaxed">
                  {proProduct.description}
                </CardDescription>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {freeProducts.map((p) => (
                    <Badge key={p.slug} variant="secondary" className="gap-1.5">
                      <p.icon className="size-3" />
                      {p.shortName}
                    </Badge>
                  ))}
                  <span className="text-xs text-muted-foreground">— all in one pass</span>
                </div>

                <Button asChild size="lg" className="mt-8 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white border-0">
                  <Link to="/products/pro">
                    <Crown className="size-4" data-icon="inline-start" />
                    Try Upscale Pro
                    <ArrowRight className="size-4" data-icon="inline-end" />
                  </Link>
                </Button>
              </CardHeader>
            </Card>
          </PageContainer>
        </section>
      )}
    </>
  );
}
