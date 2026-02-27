'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  SolCrushChain,
  generateMatchId,
  matchIdToHex,
  explorerUrl,
  toChainAmount,
} from '../lib/solcrushChain';

// ============================================================================
// SOLCRUSH - PvP Match-3 on Solana
// ============================================================================

// Candy-style gem colors
const GEM_TYPES = [
  { id: 'red', primary: '#FF4757', highlight: '#FF6B7A', dark: '#C0392B', glow: '#FF4757', emoji: '🔴' },
  { id: 'orange', primary: '#FF9F43', highlight: '#FFBE76', dark: '#E67E22', glow: '#FF9F43', emoji: '🟠' },
  { id: 'yellow', primary: '#FECA57', highlight: '#FFF200', dark: '#F39C12', glow: '#FECA57', emoji: '🟡' },
  { id: 'green', primary: '#26DE81', highlight: '#7BED9F', dark: '#20BF6B', glow: '#26DE81', emoji: '🟢' },
  { id: 'blue', primary: '#45AAF2', highlight: '#74B9FF', dark: '#2E86DE', glow: '#45AAF2', emoji: '🔵' },
  { id: 'purple', primary: '#A55EEA', highlight: '#D980FA', dark: '#8854D0', glow: '#A55EEA', emoji: '🟣' },
];

const BOARD_ROWS = 8;
const BOARD_COLS = 7;
const ROUND_TIME = 60;
const TOTAL_ROUNDS = 4;
const STAKE_OPTIONS = [1, 2, 5, 10];

// Generate board without matches
const generateBoard = () => {
  const board: any[][] = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    const rowArray: any[] = [];
    for (let col = 0; col < BOARD_COLS; col++) {
      let gemIndex;
      do {
        gemIndex = Math.floor(Math.random() * GEM_TYPES.length);
      } while (
        (col >= 2 && rowArray[col - 1]?.type === gemIndex && rowArray[col - 2]?.type === gemIndex) ||
        (row >= 2 && board[row - 1]?.[col]?.type === gemIndex && board[row - 2]?.[col]?.type === gemIndex)
      );
      rowArray.push({
        type: gemIndex,
        id: `${row}-${col}-${Date.now()}-${Math.random()}`,
        isNew: false,
        isMatched: false,
        special: null,
      });
    }
    board.push(rowArray);
  }
  return board;
};

const shortenAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

// ============================================================================
// AUDIO ENGINE
// ============================================================================

class AudioEngine {
  private audioContext: AudioContext | null = null;
  private musicEnabled = true;
  private sfxEnabled = true;

  init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.3) {
    if (!this.sfxEnabled || !this.audioContext) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.start();
    osc.stop(this.audioContext.currentTime + duration);
  }

  playSelect() { this.playTone(880, 0.08); }
  playSwap() { this.playTone(440, 0.1); setTimeout(() => this.playTone(550, 0.1), 50); }
  playMatch(count = 3) {
    const base = 523.25;
    [0, 4, 7, 12].slice(0, Math.min(count, 4)).forEach((n, i) => {
      setTimeout(() => this.playTone(base * Math.pow(2, n / 12), 0.15), i * 60);
    });
  }
  playCombo(level: number) {
    const base = 659.25 * (1 + level * 0.1);
    [0, 4, 7, 12, 16].forEach((n, i) => {
      setTimeout(() => this.playTone(base * Math.pow(2, n / 12), 0.12, 'square', 0.2), i * 40);
    });
  }
  playBomb() { this.playTone(80, 0.3); }
  playElectric() { for (let i = 0; i < 5; i++) setTimeout(() => this.playTone(1200 + Math.random() * 800, 0.05, 'sawtooth'), i * 30); }
  playInvalid() { this.playTone(200, 0.15, 'square'); setTimeout(() => this.playTone(150, 0.15, 'square'), 100); }
  playVictory() { [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => setTimeout(() => this.playTone(f, 0.25), i * 150)); }
  playDefeat() { [392, 349.23, 329.63, 293.66].forEach((f, i) => setTimeout(() => this.playTone(f, 0.3), i * 200)); }
  playClick() { this.playTone(600, 0.05); }

  toggleSfx() { this.sfxEnabled = !this.sfxEnabled; return this.sfxEnabled; }
}

const audio = new AudioEngine();

// ============================================================================
// COMPONENTS
// ============================================================================

// Wallet Button
const WalletButton: React.FC = () => {
const { publicKey, disconnect, connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (publicKey) {
      connection.getBalance(publicKey).then((bal) => setBalance(bal / LAMPORTS_PER_SOL));
      const sub = connection.onAccountChange(publicKey, (acc) => setBalance(acc.lamports / LAMPORTS_PER_SOL));
      return () => { connection.removeAccountChangeListener(sub); };
    }
  }, [publicKey, connection]);

  if (connecting) {
    return (
      <div className="px-6 py-3 rounded-2xl bg-white/10 flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        <span className="text-white/70">Connecting...</span>
      </div>
    );
  }

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-green-500/15 border border-green-500/40">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-green-400 font-semibold text-sm">{shortenAddress(publicKey.toBase58())}</span>
        </div>
        <div className="px-4 py-2.5 rounded-2xl bg-white/10 font-bold text-white">
          {balance.toFixed(2)} SOL
        </div>
        <button onClick={() => disconnect()} className="p-2.5 rounded-xl bg-white/5 hover:bg-red-500/20 text-white/60 hover:text-red-400 transition">✕</button>
      </div>
    );
  }

  return (
    <button onClick={() => setVisible(true)} className="group relative">
      <div className="absolute inset-0 rounded-2xl blur-lg opacity-60 group-hover:opacity-100 transition bg-gradient-to-r from-purple-600 to-pink-600" />
      <div className="relative px-6 py-3 rounded-2xl font-bold text-white flex items-center gap-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 transition">
        <span className="text-xl">👻</span>
        Connect Wallet
      </div>
    </button>
  );
};

// Candy-style Gem
const Gem: React.FC<{ gem: any; isSelected: boolean; onClick: () => void; disabled: boolean }> = ({ gem, isSelected, onClick, disabled }) => {
  const gemData = GEM_TYPES[gem.type];
  const size = 44;

  if (gem.special === 'bomb') {
    return (
      <div onClick={disabled ? undefined : onClick}
        className={`relative flex items-center justify-center transition-all duration-150 ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${gem.isMatched ? 'animate-gem-match' : ''} ${gem.isNew ? 'animate-gem-drop' : ''}`}
        style={{ width: size, height: size, transform: isSelected ? 'scale(1.15)' : undefined }}>
        <div className="absolute rounded-xl animate-pulse"
          style={{ width: size - 4, height: size - 4, background: `linear-gradient(135deg, ${gemData.highlight}, ${gemData.primary}, ${gemData.dark})`, boxShadow: `0 4px 15px ${gemData.glow}60, inset 0 2px 4px rgba(255,255,255,0.4)`, border: isSelected ? '3px solid white' : '2px solid rgba(255,255,255,0.3)', borderRadius: '12px' }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute w-full h-2 bg-white/40 rounded-full" style={{ transform: 'rotate(45deg)' }} />
            <div className="absolute w-full h-2 bg-white/40 rounded-full" style={{ transform: 'rotate(-45deg)' }} />
          </div>
          <div className="absolute inset-0 flex items-center justify-center text-lg">💣</div>
        </div>
      </div>
    );
  }

  if (gem.special === 'electric') {
    return (
      <div onClick={disabled ? undefined : onClick}
        className={`relative flex items-center justify-center transition-all duration-150 ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${gem.isMatched ? 'animate-gem-match' : ''} ${gem.isNew ? 'animate-gem-drop' : ''}`}
        style={{ width: size, height: size, transform: isSelected ? 'scale(1.15)' : undefined }}>
        <div className="absolute rounded-xl" style={{ width: size - 4, height: size - 4, background: 'linear-gradient(135deg, #FFF, #FFD700, #FF8C00)', boxShadow: '0 0 20px #FFD700, 0 0 40px #FF8C0050', border: '2px solid #FFD700', borderRadius: '12px', animation: 'electric-pulse 0.5s ease-in-out infinite' }}>
          <div className="absolute inset-0 flex items-center justify-center text-xl">⚡</div>
        </div>
      </div>
    );
  }

  // Candy-style gem with rounded square shape
  return (
    <div onClick={disabled ? undefined : onClick}
      className={`relative flex items-center justify-center transition-all duration-150 ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer active:scale-90'} ${gem.isMatched ? 'animate-gem-match' : ''} ${gem.isNew ? 'animate-gem-drop' : ''}`}
      style={{ width: size, height: size, transform: isSelected ? 'scale(1.15)' : undefined }}>
      
      {/* Selection glow */}
      {isSelected && (
        <div className="absolute rounded-xl" style={{ width: size + 8, height: size + 8, background: `radial-gradient(circle, ${gemData.glow}60 0%, transparent 70%)`, animation: 'pulse-glow 0.8s ease-in-out infinite' }} />
      )}
      
      {/* Main candy body */}
      <div className="absolute rounded-xl overflow-hidden"
        style={{
          width: size - 4,
          height: size - 4,
          background: `linear-gradient(145deg, ${gemData.highlight} 0%, ${gemData.primary} 50%, ${gemData.dark} 100%)`,
          boxShadow: isSelected
            ? `0 0 20px ${gemData.glow}, 0 6px 20px ${gemData.glow}80, inset 0 2px 4px rgba(255,255,255,0.5)`
            : `0 4px 12px rgba(0,0,0,0.3), 0 2px 6px ${gemData.glow}40, inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.2)`,
          border: isSelected ? '3px solid white' : '2px solid rgba(255,255,255,0.3)',
          borderRadius: '12px',
        }}>
        {/* Top shine */}
        <div className="absolute" style={{ top: '8%', left: '15%', width: '50%', height: '35%', background: 'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 100%)', borderRadius: '50%', filter: 'blur(2px)' }} />
        {/* Small highlight */}
        <div className="absolute" style={{ top: '15%', left: '60%', width: '15%', height: '12%', background: 'rgba(255,255,255,0.9)', borderRadius: '50%' }} />
      </div>
      
      {/* Selection ring */}
      {isSelected && (
        <div className="absolute rounded-xl border-2 border-white border-dashed" style={{ width: size + 4, height: size + 4, animation: 'spin 4s linear infinite' }} />
      )}
    </div>
  );
};

// Background with candy theme
const GameBackground: React.FC = () => (
  <div className="fixed inset-0 overflow-hidden pointer-events-none">
    {/* Gradient background - candy colors */}
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #667eea 0%, #764ba2 50%, #f093fb 100%)' }} />
    
    {/* Floating candy orbs */}
    {[...Array(8)].map((_, i) => (
      <div key={i} className="absolute rounded-full opacity-30"
        style={{
          width: 80 + i * 30,
          height: 80 + i * 30,
          left: `${10 + i * 12}%`,
          top: `${5 + (i % 4) * 25}%`,
          background: `radial-gradient(circle, ${GEM_TYPES[i % 6].glow} 0%, transparent 70%)`,
          animation: `float ${6 + i}s ease-in-out infinite`,
          animationDelay: `${i * 0.5}s`,
        }} />
    ))}
    
    {/* Sparkles */}
    {[...Array(20)].map((_, i) => (
      <div key={`s-${i}`} className="absolute w-1.5 h-1.5 bg-white rounded-full"
        style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, animation: `twinkle ${2 + Math.random() * 2}s ease-in-out infinite`, animationDelay: `${Math.random() * 3}s`, opacity: 0.6 }} />
    ))}
  </div>
);

// Logo Component
const SolCrushLogo: React.FC = () => (
  <div className="text-center">
    <h1 className="text-6xl font-black tracking-tight" style={{
      background: 'linear-gradient(135deg, #FF6B6B 0%, #FFE66D 25%, #4ECDC4 50%, #45B7D1 75%, #A55EEA 100%)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
      textShadow: '0 0 40px rgba(255,255,255,0.3)',
    }}>
      SolCrush
    </h1>
    <div className="flex items-center justify-center gap-2 mt-2">
      <span className="text-white/80 text-lg">PvP Match-3</span>
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white">on Solana</span>
    </div>
  </div>
);

// Transaction Toast
const Toast: React.FC<{ status: 'pending' | 'success' | 'error'; message: string; signature?: string }> = ({ status, message, signature }) => (
  <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-sm border text-sm font-semibold transition-all
    ${status === 'pending' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' : ''}
    ${status === 'success' ? 'bg-green-500/20 border-green-500/40 text-green-300' : ''}
    ${status === 'error'   ? 'bg-red-500/20 border-red-500/40 text-red-300' : ''}`}>
    {status === 'pending' && <div className="w-4 h-4 border-2 border-yellow-300/40 border-t-yellow-300 rounded-full animate-spin flex-shrink-0" />}
    {status === 'success' && <span className="flex-shrink-0">✅</span>}
    {status === 'error'   && <span className="flex-shrink-0">❌</span>}
    <span className="max-w-xs truncate">{message}</span>
    {signature && (
      <a
        href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline opacity-70 hover:opacity-100 whitespace-nowrap"
      >
        View ↗
      </a>
    )}
  </div>
);

// Results Screen
const ResultsScreen: React.FC<{
  isWinner: boolean;
  player1Score: number;
  player2Score: number;
  stake: number;
  stakeType: string;
  onPlayAgain: () => void;
  onExit: () => void;
}> = ({ isWinner, player1Score, player2Score, stake, stakeType, onPlayAgain, onExit }) => {
  useEffect(() => {
    audio.init();
    if (isWinner) audio.playVictory();
    else audio.playDefeat();
  }, [isWinner]);

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="relative w-full max-w-sm">
        {isWinner && [...Array(25)].map((_, i) => (
          <div key={i} className="absolute w-3 h-3 rounded-full animate-confetti"
            style={{ left: '50%', top: '30%', background: GEM_TYPES[i % 6].primary, animationDelay: `${i * 0.04}s`, '--tx': `${(Math.random() - 0.5) * 300}px`, '--ty': `${(Math.random() - 0.5) * 300}px` } as any} />
        ))}
        <div className="p-8 rounded-3xl text-center space-y-6 border-2"
          style={{
            background: isWinner ? 'linear-gradient(135deg, rgba(16,185,129,0.3), rgba(5,150,105,0.4))' : 'linear-gradient(135deg, rgba(239,68,68,0.3), rgba(185,28,28,0.4))',
            borderColor: isWinner ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)',
            boxShadow: `0 0 60px ${isWinner ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
          }}>
          <div className={`text-8xl ${isWinner ? 'animate-bounce' : ''}`}>{isWinner ? '🏆' : '💔'}</div>
          <div>
            <h2 className={`text-5xl font-black ${isWinner ? 'text-green-400' : 'text-red-400'}`}>{isWinner ? 'SWEET!' : 'CRUSHED'}</h2>
            <p className="text-white/80 mt-2 text-lg">
              {isWinner
                ? <span>You won <span className="text-green-400 font-bold">{(stake * 2 * 0.975).toFixed(2)} {stakeType}</span></span>
                : <span>You lost <span className="text-red-400 font-bold">{stake} {stakeType}</span></span>}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-black/30 space-y-3">
            <div className="flex justify-between text-white"><span className="text-white/60">Your Score</span><span className="font-bold text-2xl">{player1Score.toLocaleString()}</span></div>
            <div className="h-px bg-white/10" />
            <div className="flex justify-between text-white/60"><span>Opponent</span><span className="font-bold text-lg">{player2Score.toLocaleString()}</span></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { audio.playClick(); onPlayAgain(); }}
              className="flex-1 py-4 rounded-2xl font-bold text-lg text-white transition-transform hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>🍬 Play Again</button>
            <button onClick={() => { audio.playClick(); onExit(); }}
              className="px-6 py-4 rounded-2xl font-bold text-white/80 bg-white/10 hover:bg-white/20 transition">Exit</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN GAME
// ============================================================================

const SolCrush: React.FC = () => {
const { connected, publicKey, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const [gamePhase, setGamePhase] = useState<'lobby' | 'stake' | 'matchmaking' | 'playing' | 'results'>('lobby');
  const [selectedStake, setSelectedStake] = useState(5);
  const [stakeType, setStakeType] = useState<'SOL' | 'USDC'>('USDC');
  const [board, setBoard] = useState(generateBoard);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [player1Score, setPlayer1Score] = useState(0);
  const [player2Score, setPlayer2Score] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(ROUND_TIME);
  const [combo, setCombo] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCombo, setShowCombo] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [balance, setBalance] = useState(0);

  // ── Blockchain state ──────────────────────────────────────────────────────
  const [matchId, setMatchId] = useState<Uint8Array | null>(null);
  const [opponentPubkey, setOpponentPubkey] = useState<PublicKey | null>(null);
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txMessage, setTxMessage] = useState('');
  const [isP1, setIsP1] = useState(true); // true if this wallet created the match

  // Fetch balance
  useEffect(() => {
    if (publicKey) {
      connection.getBalance(publicKey).then((b) => setBalance(b / LAMPORTS_PER_SOL));
    }
  }, [publicKey, connection]);

  // Timer
  useEffect(() => {
    if (gamePhase !== 'playing' || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          if (currentRound >= TOTAL_ROUNDS) { setGamePhase('results'); return 0; }
          else { setCurrentRound((r) => r + 1); setBoard(generateBoard()); return ROUND_TIME; }
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [gamePhase, timeLeft, currentRound]);

  // Opponent AI
  useEffect(() => {
    if (gamePhase !== 'playing') return;
    const interval = setInterval(() => setPlayer2Score((s) => s + Math.floor(Math.random() * 25) + 15), 2000 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, [gamePhase]);

  // ── Blockchain: Create match + deposit stake (P1 flow) ───────────────────
const handleFindMatch = async () => {
  audio.playClick();
  if (!publicKey) return;

  setGamePhase('matchmaking');
  setTxStatus('pending');
  setTxMessage('Signing deposit transaction...');

  try {
    const chain = new SolCrushChain({ publicKey, signTransaction, signAllTransactions } as any, connection);
    const isSol = stakeType === 'SOL';
    const { matchId: newMatchId, signature } = await chain.createMatch(selectedStake, isSol);
    setMatchId(newMatchId);
    setIsP1(true);
    setTxStatus('success');
    setTxSignature(signature);
    setTxMessage(`Stake deposited! 🍬`);
  } catch (err: any) {
    setTxStatus('error');
    setTxMessage(err?.message?.slice(0, 80) || 'Transaction failed');
  }

  setTimeout(() => startGame(), 2500);
};

  // Find matches
  const findMatches = useCallback((boardState: any[][]) => {
    const matches: { row: number; col: number }[] = [];
    const groups: any[] = [];

    for (let row = 0; row < BOARD_ROWS; row++) {
      let col = 0;
      while (col < BOARD_COLS) {
        const type = boardState[row][col].type;
        let len = 1;
        while (col + len < BOARD_COLS && boardState[row][col + len].type === type) len++;
        if (len >= 3) {
          const group = { positions: [] as any[], type, length: len };
          for (let i = 0; i < len; i++) { matches.push({ row, col: col + i }); group.positions.push({ row, col: col + i }); }
          groups.push(group);
        }
        col += Math.max(1, len);
      }
    }

    for (let col = 0; col < BOARD_COLS; col++) {
      let row = 0;
      while (row < BOARD_ROWS) {
        const type = boardState[row][col].type;
        let len = 1;
        while (row + len < BOARD_ROWS && boardState[row + len][col].type === type) len++;
        if (len >= 3) {
          const group = { positions: [] as any[], type, length: len };
          for (let i = 0; i < len; i++) { matches.push({ row: row + i, col }); group.positions.push({ row: row + i, col }); }
          groups.push(group);
        }
        row += Math.max(1, len);
      }
    }
    return { matches, groups };
  }, []);

  // Process matches
const processMatches = useCallback(async (boardState: any[][], swapPos: { row: number; col: number } | null = null): Promise<{ board: any[][], scored: number }> => {
  const { matches, groups } = findMatches(boardState);
    if (matches.length === 0) return { board: boardState, scored: 0 };

    audio.playMatch(matches.length);

    let newBoard = boardState.map((r) => r.map((g) => ({ ...g })));
    let totalScored = 0;
    let specialToCreate: any = null;

    for (const g of groups) {
      if (g.length >= 5) specialToCreate = { type: 'electric', gemType: g.type, pos: swapPos || g.positions[2] };
      else if (g.length === 4 && !specialToCreate) specialToCreate = { type: 'bomb', gemType: g.type, pos: swapPos || g.positions[1] };
    }

    const matchSet = new Set(matches.map((m) => `${m.row}-${m.col}`));

    for (const match of matches) {
      const gem = newBoard[match.row][match.col];
      if (gem.special === 'bomb') {
        audio.playBomb();
        for (let r = Math.max(0, match.row - 1); r <= Math.min(BOARD_ROWS - 1, match.row + 1); r++) {
          for (let c = Math.max(0, match.col - 1); c <= Math.min(BOARD_COLS - 1, match.col + 1); c++) {
            matchSet.add(`${r}-${c}`);
          }
        }
      } else if (gem.special === 'electric') {
        audio.playElectric();
        for (let i = 0; i < 5 + Math.floor(Math.random() * 3); i++) {
          matchSet.add(`${Math.floor(Math.random() * BOARD_ROWS)}-${Math.floor(Math.random() * BOARD_COLS)}`);
        }
      }
    }

    matchSet.forEach((key) => {
      const [row, col] = key.split('-').map(Number);
      if (newBoard[row]?.[col]) { newBoard[row][col].isMatched = true; totalScored += 10; }
    });

    setBoard([...newBoard]);
    await new Promise((r) => setTimeout(r, 200));

    matchSet.forEach((key) => {
      const [row, col] = key.split('-').map(Number);
      if (newBoard[row]?.[col]) newBoard[row][col] = null;
    });

    for (let col = 0; col < BOARD_COLS; col++) {
      let writeRow = BOARD_ROWS - 1;
      for (let row = BOARD_ROWS - 1; row >= 0; row--) {
        if (newBoard[row][col]) {
          if (row !== writeRow) { newBoard[writeRow][col] = { ...newBoard[row][col] }; newBoard[row][col] = null; }
          writeRow--;
        }
      }
      for (let row = writeRow; row >= 0; row--) {
        newBoard[row][col] = { type: Math.floor(Math.random() * GEM_TYPES.length), id: `${row}-${col}-${Date.now()}-${Math.random()}`, isNew: true, isMatched: false, special: null };
      }
    }

    if (specialToCreate && newBoard[specialToCreate.pos.row]?.[specialToCreate.pos.col]) {
      newBoard[specialToCreate.pos.row][specialToCreate.pos.col] = { type: specialToCreate.gemType, id: `special-${Date.now()}`, isNew: true, isMatched: false, special: specialToCreate.type };
    }

    setBoard([...newBoard]);
    await new Promise((r) => setTimeout(r, 300));

    newBoard = newBoard.map((r) => r.map((g) => (g ? { ...g, isNew: false } : g)));

    const result = await processMatches(newBoard);
    return { board: result.board, scored: totalScored + result.scored };
  }, [findMatches]);

  // Handle gem click
  const handleGemClick = async (row: number, col: number) => {
    if (isProcessing || timeLeft <= 0 || gamePhase !== 'playing') return;

    audio.init();

    if (!selected) {
      audio.playSelect();
      setSelected({ row, col });
      return;
    }

    const isAdjacent = (Math.abs(selected.row - row) === 1 && selected.col === col) || (Math.abs(selected.col - col) === 1 && selected.row === row);
    if (!isAdjacent) { audio.playSelect(); setSelected({ row, col }); return; }

    setIsProcessing(true);
    audio.playSwap();

    const newBoard = board.map((r) => r.map((g) => ({ ...g })));
    const temp = newBoard[row][col];
    newBoard[row][col] = newBoard[selected.row][selected.col];
    newBoard[selected.row][selected.col] = temp;
    setBoard(newBoard);

    await new Promise((r) => setTimeout(r, 180));

    const { matches } = findMatches(newBoard);
    if (matches.length > 0) {
      const result = await processMatches(newBoard, { row, col });
      const points = result.scored * (combo + 1);
      setPlayer1Score((s) => s + points);
      setCombo((c) => c + 1);
      if (combo >= 1) audio.playCombo(combo + 1);
      setShowCombo(true);
      setTimeout(() => setShowCombo(false), 900);
    } else {
      audio.playInvalid();
      setBoard(board.map((r) => r.map((g) => ({ ...g }))));
      setCombo(0);
    }

    setSelected(null);
    setIsProcessing(false);
  };

  const isWinner = player1Score > player2Score;

  // ── Blockchain: Resolve match when results screen shows ───────────────────
  useEffect(() => {
    if (gamePhase !== 'results' || !matchId || !publicKey) return;

    const settle = async () => {
      try {
        setTxStatus('pending');
        setTxMessage('Settling match on-chain...');
        const chain = new SolCrushChain({ publicKey, signTransaction, signAllTransactions } as any, connection);
        const isSol = stakeType === 'SOL';

        // Use real opponent pubkey if available, otherwise use self as placeholder for devnet testing
        const p1 = isP1 ? publicKey : (opponentPubkey ?? publicKey);
        const p2 = isP1 ? (opponentPubkey ?? publicKey) : publicKey;
        const winner = isWinner ? publicKey : (opponentPubkey ?? publicKey);

        const sig = await chain.resolveMatch(matchId, p1, p2, isSol, winner);
        setTxSignature(sig);
        setTxStatus('success');
        setTxMessage(isWinner ? `You won! Payout sent 🎉` : `Opponent wins. Better luck next time!`);
      } catch (err: any) {
        setTxStatus('error');
        setTxMessage(err?.message?.slice(0, 80) || 'Settlement failed');
      }
    };

    settle();
  }, [gamePhase]); // eslint-disable-line

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <GameBackground />

      <style>{`
        @keyframes gem-match { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); } 100% { transform: scale(0); opacity: 0; } }
        @keyframes gem-drop { 0% { transform: translateY(-80px) scale(0.5); opacity: 0; } 70% { transform: translateY(8px) scale(1.08); } 100% { transform: translateY(0) scale(1); opacity: 1; } }
        @keyframes pulse-glow { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 0.9; transform: scale(1.1); } }
        @keyframes float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-20px) rotate(5deg); } }
        @keyframes twinkle { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.5); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes electric-pulse { 0%, 100% { box-shadow: 0 0 15px #FFD700, 0 0 30px #FF8C00; } 50% { box-shadow: 0 0 30px #FFD700, 0 0 60px #FF8C00; } }
        @keyframes confetti { 0% { transform: translate(0, 0) rotate(0deg); opacity: 1; } 100% { transform: translate(var(--tx), var(--ty)) rotate(720deg); opacity: 0; } }
        @keyframes combo-pop { 0% { transform: translate(-50%, 0) scale(0) rotate(-15deg); } 60% { transform: translate(-50%, 0) scale(1.2) rotate(5deg); } 100% { transform: translate(-50%, 0) scale(1) rotate(0); } }
        .animate-gem-match { animation: gem-match 0.35s ease-out forwards; }
        .animate-gem-drop { animation: gem-drop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .animate-confetti { animation: confetti 1s ease-out forwards; }
      `}</style>

      {/* LOBBY */}
      {gamePhase === 'lobby' && (
        <div className="relative z-10 w-full max-w-md text-center space-y-8">
          <SolCrushLogo />
          
          <div className="flex justify-center gap-2">
            {GEM_TYPES.map((gem, i) => (
              <div key={gem.id} className="w-12 h-12 rounded-xl"
                style={{ background: `linear-gradient(135deg, ${gem.highlight}, ${gem.primary}, ${gem.dark})`, boxShadow: `0 4px 20px ${gem.glow}50`, animation: `float ${3 + i * 0.3}s ease-in-out infinite`, animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>

          <div className="flex justify-center">
            <WalletButton />
          </div>

          {connected && (
            <>
              <button onClick={() => { audio.init(); audio.playClick(); setGamePhase('stake'); }} className="group relative w-full">
                <div className="absolute inset-0 rounded-2xl blur-xl opacity-70 group-hover:opacity-100 transition" style={{ background: 'linear-gradient(135deg, #26DE81, #20BF6B)' }} />
                <div className="relative w-full py-5 rounded-2xl font-black text-xl text-white flex items-center justify-center gap-3 transition-transform hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg, #26DE81, #20BF6B)' }}>
                  <span className="text-2xl">🍬</span> PLAY NOW
                </div>
              </button>

              <div className="grid grid-cols-3 gap-3">
                {[{ v: '2.4K', l: 'Playing', c: '#26DE81' }, { v: '$18.2K', l: 'Prize Pool', c: '#FECA57' }, { v: '1.2K', l: 'Matches', c: '#A55EEA' }].map((s, i) => (
                  <div key={i} className="p-4 rounded-2xl bg-white/10 backdrop-blur-sm">
                    <div className="text-2xl font-black" style={{ color: s.c }}>{s.v}</div>
                    <div className="text-white/50 text-xs mt-1">{s.l}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="text-white/40 text-sm">Powered by Solana ⚡ Built with MagicBlock</p>
        </div>
      )}

      {/* STAKE SELECTION */}
      {gamePhase === 'stake' && (
        <div className="relative z-10 w-full max-w-md space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white">Choose Your Stake</h2>
            <p className="text-white/50 mt-2">Match and win big! 🍬</p>
          </div>

          <div className="flex justify-center">
            <div className="p-1 rounded-2xl bg-white/10 backdrop-blur-sm">
              {['SOL', 'USDC'].map((t) => (
                <button key={t} onClick={() => { audio.playClick(); setStakeType(t as any); }}
                  className={`relative px-8 py-3 rounded-xl font-bold transition-all ${stakeType === t ? 'text-white' : 'text-white/50'}`}>
                  {stakeType === t && <div className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }} />}
                  <span className="relative">{t === 'SOL' ? '◎' : '$'} {t}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {STAKE_OPTIONS.map((v) => (
              <button key={v} onClick={() => { audio.playClick(); setSelectedStake(v); }}
                className="relative p-1 rounded-2xl transition-all"
                style={{ background: selectedStake === v ? 'linear-gradient(135deg, #FECA57, #FF9F43)' : 'rgba(255,255,255,0.1)' }}>
                <div className={`py-6 rounded-xl font-black text-2xl ${selectedStake === v ? 'bg-black/20 text-white' : 'text-white/70'}`}>
                  <span className="text-sm opacity-70">{stakeType === 'SOL' ? '◎' : '$'}</span>{v}
                </div>
                {selectedStake === v && <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-400 rounded-full flex items-center justify-center text-sm text-black font-bold shadow-lg">✓</div>}
              </button>
            ))}
          </div>

          <div className="text-center p-4 rounded-2xl bg-white/5 backdrop-blur-sm">
            <div className="text-white/50 text-sm">Winner Takes</div>
            <div className="text-4xl font-black mt-1" style={{ background: 'linear-gradient(135deg, #FECA57, #FF9F43)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {(selectedStake * 2 * 0.975).toFixed(2)} {stakeType}
            </div>
            <div className="text-white/30 text-xs mt-2">2.5% platform fee</div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { audio.playClick(); setGamePhase('lobby'); }} className="flex-1 py-4 rounded-2xl font-bold text-white/70 bg-white/10">← Back</button>
            <button onClick={handleFindMatch}
              className="flex-1 py-4 rounded-2xl font-bold text-white transition-transform hover:scale-105" style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
              Find Match 🍬
            </button>
          </div>
        </div>
      )}

      {/* MATCHMAKING */}
      {gamePhase === 'matchmaking' && (
        <div className="relative z-10 text-center space-y-8">
          {/* Transaction toast */}
          {txStatus !== 'idle' && (
            <Toast
              status={txStatus === 'pending' ? 'pending' : txStatus === 'success' ? 'success' : 'error'}
              message={txMessage}
              signature={txSignature ?? undefined}
            />
          )}
          <div className="relative w-32 h-32 mx-auto">
            {[0, 1, 2].map((i) => (
              <div key={i} className="absolute inset-0 rounded-full border-4 border-transparent"
                style={{ borderTopColor: GEM_TYPES[i].glow, borderRightColor: GEM_TYPES[i + 1].glow, animation: `spin ${1.2 + i * 0.4}s linear infinite`, animationDirection: i % 2 === 0 ? 'normal' : 'reverse', transform: `scale(${1 - i * 0.15})` }} />
            ))}
            <div className="absolute inset-0 flex items-center justify-center"><span className="text-5xl animate-bounce">🍬</span></div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Finding Opponent...</h2>
            <p className="text-white/50 mt-2">Stake: {selectedStake} {stakeType}</p>
          </div>
          <button onClick={() => setGamePhase('lobby')} className="px-8 py-3 rounded-2xl font-bold text-white/70 bg-white/10">Cancel</button>
        </div>
      )}

      {/* GAME */}
      {gamePhase === 'playing' && (
        <div className="relative z-10 w-full max-w-sm">
          {/* Header */}
          <div className="p-4 rounded-t-3xl" style={{ background: 'linear-gradient(180deg, rgba(102,126,234,0.95), rgba(118,75,162,0.95))', backdropFilter: 'blur(10px)' }}>
            <div className="flex justify-between items-center">
              <div className="text-center">
                <div className="text-3xl font-black text-white">{player1Score.toLocaleString()}</div>
                <div className="text-xs text-blue-200 font-medium">YOU</div>
              </div>
              <div className="text-center px-4 py-2 rounded-2xl bg-white/10">
                <div className="text-white font-bold">Round {currentRound}/{TOTAL_ROUNDS}</div>
                <div className="text-yellow-300 text-sm font-medium">{selectedStake} {stakeType}</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-white">{player2Score.toLocaleString()}</div>
                <div className="text-xs text-red-200 font-medium">OPP</div>
              </div>
            </div>
          </div>

          {/* Timer */}
          <div className="py-3 text-center" style={{ background: 'linear-gradient(180deg, rgba(118,75,162,0.95), rgba(50,50,80,0.95))' }}>
            <span className={`text-4xl font-black ${timeLeft <= 10 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
              {timeLeft <= 10 ? '🔥' : '⏱'} {timeLeft}s
            </span>
          </div>

          {/* Board */}
          <div className="relative p-3" style={{ background: 'linear-gradient(180deg, #1a1a2e, #0d0d1a)' }}>
            {showCombo && combo >= 2 && (
              <div className="absolute top-4 left-1/2 z-30" style={{ animation: 'combo-pop 0.5s ease-out', transform: 'translateX(-50%)' }}>
                <div className="px-6 py-2 rounded-full font-black text-2xl text-white whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg, #FECA57, #FF9F43, #FF6B6B)', boxShadow: '0 0 30px rgba(254,202,87,0.6)' }}>
                  {combo}x SWEET! 🍬
                </div>
              </div>
            )}

            <div className="grid gap-1 p-2 rounded-2xl mx-auto"
              style={{ gridTemplateColumns: `repeat(${BOARD_COLS}, 44px)`, background: 'rgba(255,255,255,0.05)', border: '2px solid rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.5)' }}>
              {board.map((row, ri) => row.map((gem, ci) => (
                <Gem key={gem.id} gem={gem} isSelected={selected?.row === ri && selected?.col === ci}
                  onClick={() => handleGemClick(ri, ci)} disabled={isProcessing || timeLeft <= 0} />
              )))}
            </div>

            <div className="flex justify-center gap-6 mt-3 text-xs text-white/40">
              <span>💣 Match 4</span>
              <span>⚡ Match 5</span>
            </div>
          </div>

          {/* Footer */}
          <div className="py-3 text-center rounded-b-3xl" style={{ background: '#0d0d1a' }}>
            <p className="text-white/30 text-xs">SolCrush PvP • Powered by Solana</p>
          </div>
        </div>
      )}

      {/* RESULTS */}
      {gamePhase === 'results' && (
        <>
          {txStatus !== 'idle' && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-80">
              <Toast
                status={txStatus === 'pending' ? 'pending' : txStatus === 'success' ? 'success' : 'error'}
                message={txMessage}
                signature={txSignature ?? undefined}
              />
            </div>
          )}
          <ResultsScreen isWinner={isWinner} player1Score={player1Score} player2Score={player2Score}
            stake={selectedStake} stakeType={stakeType} onPlayAgain={() => setGamePhase('matchmaking')}
            onExit={() => setGamePhase('lobby')} />
        </>
      )}
    </div>
  );
};

export default SolCrush;
