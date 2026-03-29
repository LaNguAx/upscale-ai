import { Link } from 'react-router';
import { NAV_LINKS } from '@/consts/navigation';

export function Footer() {
  return (
    <footer className="section-alt border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Link to="/" className="flex items-center gap-2.5">
              <img src="/upscale-logo.png" alt="Upscale AI" className="h-7 w-7" />
              <span className="text-base font-bold tracking-tight text-foreground">
                Upscale AI
              </span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground max-w-xs">
              AI-powered video restoration and super-resolution. Breathe new life into legacy
              video content using deep learning.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Quick Links</h3>
            <ul className="mt-3 space-y-2">
              {NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  to="/products"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Products
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Project</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>B.Sc. Computer Science</li>
              <li>Deep Learning Specialization</li>
              <li>The College of Management</li>
              <li>Supervised by Dr. Moshe Butman</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Upscale AI. B.Sc. Computer Science Final Project.
        </div>
      </div>
    </footer>
  );
}
