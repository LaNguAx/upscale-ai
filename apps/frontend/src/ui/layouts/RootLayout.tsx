import { Outlet } from 'react-router';
import { Navbar } from '@/ui/components/Navbar';
import { Footer } from '@/ui/components/Footer';

export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
