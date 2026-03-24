import { createBrowserRouter } from 'react-router';
import { Root } from '@/ui/Root';
import { RootLayout } from '@/ui/layouts/RootLayout';
import { Home } from '@/ui/pages/Home';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    children: [
      {
        Component: RootLayout,
        children: [
          {
            index: true,
            Component: Home,
          },
        ],
      },
    ],
  },
]);
