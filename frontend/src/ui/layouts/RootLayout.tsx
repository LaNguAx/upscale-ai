import { Outlet, NavLink } from 'react-router';

export function RootLayout() {
  return (
    <div>
      <header>
        <nav>
          <NavLink to="/">Upscale AI</NavLink>
          <NavLink to="/" end>
            Home
          </NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
