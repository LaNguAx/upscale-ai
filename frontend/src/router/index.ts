import { createBrowserRouter } from 'react-router';
import { Root } from '@/ui/Root';
import { RootLayout } from '@/ui/layouts/RootLayout';
import { Home } from '@/ui/pages/Home';
import { Products } from '@/ui/pages/Products';
import { Product } from '@/ui/pages/Product';
import { Technology } from '@/ui/pages/Technology';
import { About } from '@/ui/pages/About';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    children: [
      {
        Component: RootLayout,
        children: [
          { index: true, Component: Home },
          { path: 'products', Component: Products },
          { path: 'products/:slug', Component: Product },
          { path: 'technology', Component: Technology },
          { path: 'about', Component: About }
        ]
      }
    ]
  }
]);
