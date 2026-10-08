import type { Metadata, Viewport } from 'next';
import { MotionProvider } from '@/components/motion';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Rohit Kumar SEO Outreach', template: '%s · Rohit Kumar SEO Outreach' },
  description: 'Private outreach tracking dashboard for Rohit Kumar SEO.',
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f1d36' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
