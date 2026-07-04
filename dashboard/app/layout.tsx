import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import RoomTabs from '@/components/RoomTabs';
import './globals.css';

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-mono' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Habit tracker',
  description: 'Browser habit tracker dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">
        <div className="mx-auto max-w-[1100px] px-6 py-8">
          <RoomTabs />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
