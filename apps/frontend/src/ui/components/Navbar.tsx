import { useState } from 'react';
import { NavLink, Link } from 'react-router';
import { Menu, X, Upload } from 'lucide-react';
import { cn } from '@/ui/shadcn/lib/utils';
import { Button } from '@/ui/shadcn/ui/button';
import { NAV_LINKS_BEFORE, NAV_LINKS_AFTER } from '@/consts/navigation';

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/upscale-logo.png" alt="Upscale AI" className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight text-foreground">
            Upscale AI
          </span>
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
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}

          <NavLink
            to="/products"
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            Upscale Video
          </NavLink>

          {NAV_LINKS_AFTER.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button asChild size="sm">
            <Link to="/products">
              <Upload className="size-3.5" data-icon="inline-start" />
              Upscale Video
            </Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => {
            setMobileOpen(!mobileOpen);
          }}
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
                onClick={() => {
                  setMobileOpen(false);
                }}
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

            <NavLink
              to="/products"
              onClick={() => {
                setMobileOpen(false);
              }}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Upload className="size-4" />
              Upscale Video
            </NavLink>

            {NAV_LINKS_AFTER.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => {
                  setMobileOpen(false);
                }}
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
          </nav>
        </div>
      )}
    </header>
  );
}
