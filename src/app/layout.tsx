import type { Metadata } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const plex = IBM_Plex_Sans({ subsets: ['latin'], variable: '--font-plex', weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Riviera Suite PMS',
  description: 'Gestion hoteliere',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${plex.variable} font-sans`}>{children}</body>
    </html>
  );
}
