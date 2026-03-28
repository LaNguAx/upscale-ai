import { Outlet, NavLink } from 'react-router';
import { ThemeToggle } from '@/ui/components/ThemeToggle';

const navLinks = [
  { to: '/', label: 'Home', end: true },
  { to: '/upload', label: 'Upload', end: false },
  { to: '/dashboard', label: 'Dashboard', end: false }
];

export function RootLayout() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <nav className="mx-auto max-w-5xl flex items-center justify-between px-6 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-semibold text-lg text-primary">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
              U
            </span>
            Upscale AI
          </NavLink>
          <div className="flex items-center gap-1">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <div className="ml-2 border-l border-border pl-2">
              <ThemeToggle />
            </div>
          </div>
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Upscale AI &middot; Deep Learning Video Restoration
      </footer>
    </div>
  );
}
