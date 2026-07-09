import './globals.css';
import React from 'react';
import Providers from './providers';
import ProfileSwitcher from '@/components/ProfileSwitcher';
import Link from 'next/link';

export const metadata = {
  title: 'Video Streaming App',
  description: 'Netflix-style continue watching feature',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">
        <Providers>
          <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800 px-8 py-4 flex justify-between items-center">
            <Link href="/" className="font-bold text-lg tracking-wider text-red-600 hover:opacity-90">
              STREAMING
            </Link>
            <ProfileSwitcher />
          </header>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
