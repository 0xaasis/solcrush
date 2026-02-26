import './globals.css';
import { WalletContextProvider } from '../providers/WalletProvider';

export const metadata = {
  title: 'SolCrush - PvP Match-3 on Solana',
  description: 'Crush your opponents. Win crypto. The sweetest PvP puzzle game on Solana.',
  keywords: ['solana', 'game', 'pvp', 'match-3', 'crypto', 'nft', 'web3'],
  openGraph: {
    title: 'SolCrush - PvP Match-3 on Solana',
    description: 'Crush your opponents. Win crypto.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[#667eea] min-h-screen font-nunito">
        <WalletContextProvider>
          {children}
        </WalletContextProvider>
      </body>
    </html>
  );
}
