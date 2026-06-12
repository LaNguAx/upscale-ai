import { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router';
import { Menu, X, ChevronDown, Crown } from 'lucide-react';
import { cn } from '@/ui/shadcn/lib/utils';
import { Button } from '@/ui/shadcn/ui/button';
import { NAV_LINKS_BEFORE, NAV_LINKS_AFTER } from '@/consts/navigation';
import { PRODUCTS } from '@/consts/products';

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const isProductsActive = location.pathname.startsWith('/products');

  const freeProducts = PRODUCTS.filter((p) => !p.isPro);
  const proProduct = PRODUCTS.find((p) => p.isPro);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/upscale-logo.png" alt="Upscale AI" className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight text-foreground">Upscale AI</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS_BEFORE.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}

          <div className="group relative">
            <button
              className={cn(
                'flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none',
                isProductsActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Products
              <ChevronDown className="size-3.5 transition-transform group-hover:rotate-180" />
            </button>

            <div className="invisible absolute left-1/2 top-full z-50 pt-2 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100 -translate-x-1/2">
              <div className="w-56 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-md">
                {freeProducts.map((product) => (
                  <Link
                    key={product.slug}
                    to={`/products/${product.slug}`}
                    className={cn(
                      'flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                      product.isWip ? 'text-muted-foreground' : 'text-popover-foreground'
                    )}
                  >
                    <product.icon className="size-4 text-muted-foreground" />
                    <span className="font-medium">{product.name}</span>
                    {product.isWip && (
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </Link>
                ))}
                {proProduct && (
                  <>
                    <div className="-mx-1 my-1 h-px bg-border" />
                    <Link
                      to={`/products/${proProduct.slug}`}
                      className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <Crown className="size-4 text-amber-500" />
                      <span className="font-medium">
                        {proProduct.name}
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                          PRO
                        </span>
                      </span>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>

          {NAV_LINKS_AFTER.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button asChild size="sm">
            <Link to="/products/pro">
              <Crown className="size-3.5" data-icon="inline-start" />
              Try Pro
            </Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS_BEFORE.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}

            <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Products
            </div>
            {PRODUCTS.map((product) => (
              <NavLink
                key={product.slug}
                to={`/products/${product.slug}`}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )
                }
              >
                {product.isPro ? (
                  <Crown className="size-4 text-amber-500" />
                ) : (
                  <product.icon className="size-4" />
                )}
                {product.name}
                {product.isPro && (
                  <span className="ml-auto inline-flex items-center rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    PRO
                  </span>
                )}
                {product.isWip && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Soon
                  </span>
                )}
              </NavLink>
            ))}

            {NAV_LINKS_AFTER.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}

            <Button asChild size="sm" className="mt-2">
              <Link to="/products/pro" onClick={() => setMobileOpen(false)}>
                <Crown className="size-3.5" data-icon="inline-start" />
                Try Pro
              </Link>
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
}
