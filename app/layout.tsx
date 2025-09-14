import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { Inter } from 'next/font/google';

// Importando a fonte Inter, peso variável
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', weight: ['400','500','600','700'] });

export const metadata: Metadata = {
  title: 'v0 App',
  description: 'Created with v0',
  generator: 'v0.app',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`font-sans ${inter.variable} bg-gray-100`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
