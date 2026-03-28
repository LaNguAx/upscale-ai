import { createBrowserRouter } from 'react-router';
import { Root } from '@/ui/Root';
import { RootLayout } from '@/ui/layouts/RootLayout';
import { Home } from '@/ui/pages/Home';
import { Upload } from '@/ui/pages/Upload';
import { Dashboard } from '@/ui/pages/Dashboard';
import { JobDetail } from '@/ui/pages/JobDetail';

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
            Component: Home
          },
          {
            path: 'upload',
            Component: Upload
          },
          {
            path: 'dashboard',
            Component: Dashboard
          },
          {
            path: 'jobs/:jobId',
            Component: JobDetail
          }
        ]
      }
    ]
  }
]);
