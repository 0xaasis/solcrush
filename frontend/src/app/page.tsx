'use client';

import dynamic from 'next/dynamic';

// Dynamic import to avoid SSR issues with wallet adapter
const SolCrush = dynamic(
  () => import('../components/SolCrush'),
  { 
    ssr: false,
    loading: () => (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(180deg, #667eea 0%, #764ba2 50%, #f093fb 100%)' }}>
        <div className="text-center space-y-6">
          <div className="relative w-24 h-24 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-5xl">🍬</div>
          </div>
          <div>
            <h1 className="text-4xl font-black text-white" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.3)' }}>
              SolCrush
            </h1>
            <p className="text-white/70 mt-2">Loading sweet gameplay...</p>
          </div>
        </div>
      </div>
    )
  }
);

export default function Home() {
  return <SolCrush />;
}
