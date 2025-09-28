import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { Inter } from 'next/font/google';

// 🔔 Alerta global
import GlobalAlertsClient from '@/components/alerts/GlobalAlertsClient';

// (seu modal de doações e rodapé, caso tenha)
import DonateModal from '@/components/donate/DonateModal';
import Footer from '@/components/ui/footer';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', weight: ['400','500','600','700'] });

export const metadata: Metadata = {
  title: 'v0 App',
  description: 'Created with v0',
  generator: 'v0.app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`font-sans ${inter.variable} bg-gray-100`}>
        {children}

        {/* 🔔 Botão/Modal de alerta global (aparece só com alerta não lido) */}
        <GlobalAlertsClient />

        {/* 💖 Doações (PayPal/Pix) */}
        <DonateModal />

        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
