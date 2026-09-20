import type { Metadata } from 'next';
import { IBM_Plex_Sans, Fraunces } from 'next/font/google';
import './globals.css';

const plex = IBM_Plex_Sans({ subsets: ['latin'], variable: '--font-plex', weight: ['400', '500', '600', '700'] });
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  weight: 'variable',
  style: ['normal', 'italic'],
  axes: ['opsz'],
});

export const metadata: Metadata = {
  title: 'PMS Audit',
  description: 'Gestion hoteliere',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${plex.variable} ${fraunces.variable} font-sans`}>{children}</body>
    </html>
  );
}
