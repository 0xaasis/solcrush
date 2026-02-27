const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  // Health check endpoint for Railway
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('SolCrush matchmaking server running');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

// { stake -> [{ ws, publicKey, stake, matchId }] }
const waitingPlayers = new Map();

// { matchId -> { p1, p2, scores, boardSeed, gameOver } }
const activeMatches = new Map();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  log(`Client connected: ${ip}`);

  let playerInfo = null;
  let currentMatchId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ── Find Match ────────────────────────────────────────────────────────────
    if (msg.type === 'find_match') {
      const { publicKey, stake } = msg;
      if (!publicKey || !stake) return;

      playerInfo = { ws, publicKey, stake };
      const stakeKey = String(stake);

      log(`Player looking for match: ${publicKey.slice(0, 8)}... stake=${stake}`);

      // Check if someone is already waiting at this stake level
      const waiting = waitingPlayers.get(stakeKey);

      if (waiting && waiting.ws.readyState === waiting.ws.OPEN && waiting.publicKey !== publicKey) {
        // Match found!
        waitingPlayers.delete(stakeKey);

        const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const boardSeed = Math.floor(Math.random() * 999999);

        currentMatchId = matchId;
        waiting.matchId = matchId;

        activeMatches.set(matchId, {
          p1: waiting,
          p2: playerInfo,
          scores: { p1: 0, p2: 0 },
          boardSeed,
          gameOver: false,
          startTime: Date.now(),
        });

        log(`Match created: ${matchId} | P1: ${waiting.publicKey.slice(0, 8)} | P2: ${publicKey.slice(0, 8)}`);

        // Tell P1 match found
        send(waiting.ws, {
          type: 'match_found',
          matchId,
          boardSeed,
          role: 'p1',
          opponentKey: publicKey,
        });

        // Tell P2 match found
        send(ws, {
          type: 'match_found',
          matchId,
          boardSeed,
          role: 'p2',
          opponentKey: waiting.publicKey,
        });

      } else {
        // No one waiting — add to queue
        waitingPlayers.set(stakeKey, playerInfo);
        send(ws, { type: 'waiting' });
        log(`Player waiting: ${publicKey.slice(0, 8)}... stake=${stake}`);
      }
    }

    // ── Score Update ──────────────────────────────────────────────────────────
    if (msg.type === 'score_update') {
      const { matchId, role, score } = msg;
      const match = activeMatches.get(matchId);
      if (!match || match.gameOver) return;

      // Update score
      if (role === 'p1') match.scores.p1 = score;
      if (role === 'p2') match.scores.p2 = score;

      // Send opponent's score to the other player
      const opponent = role === 'p1' ? match.p2 : match.p1;
      send(opponent.ws, { type: 'opponent_score', score });
    }

    // ── Game Over ─────────────────────────────────────────────────────────────
    if (msg.type === 'game_over') {
      const { matchId, role, score } = msg;
      const match = activeMatches.get(matchId);
      if (!match || match.gameOver) return;

      // Update final score
      if (role === 'p1') match.scores.p1 = score;
      if (role === 'p2') match.scores.p2 = score;

      match.gameOver = true;

      const winner = match.scores.p1 >= match.scores.p2 ? match.p1.publicKey : match.p2.publicKey;

      log(`Match over: ${matchId} | P1: ${match.scores.p1} vs P2: ${match.scores.p2} | Winner: ${winner.slice(0, 8)}`);

      // Tell both players the result
      send(match.p1.ws, {
        type: 'result',
        p1Score: match.scores.p1,
        p2Score: match.scores.p2,
        winner,
        role: 'p1',
      });

      send(match.p2.ws, {
        type: 'result',
        p1Score: match.scores.p1,
        p2Score: match.scores.p2,
        winner,
        role: 'p2',
      });

      // Clean up after 30s
      setTimeout(() => activeMatches.delete(matchId), 30000);
    }

    // ── Cancel / Leave ────────────────────────────────────────────────────────
    if (msg.type === 'cancel') {
      const stakeKey = String(playerInfo?.stake);
      const waiting = waitingPlayers.get(stakeKey);
      if (waiting && waiting.ws === ws) {
        waitingPlayers.delete(stakeKey);
        log(`Player cancelled: ${playerInfo?.publicKey?.slice(0, 8)}`);
      }
    }
  });

  ws.on('close', () => {
    log(`Client disconnected: ${ip}`);

    // Remove from waiting queue if they disconnect
    if (playerInfo) {
      const stakeKey = String(playerInfo.stake);
      const waiting = waitingPlayers.get(stakeKey);
      if (waiting && waiting.ws === ws) {
        waitingPlayers.delete(stakeKey);
      }

      // Notify opponent if mid-match
      if (currentMatchId) {
        const match = activeMatches.get(currentMatchId);
        if (match && !match.gameOver) {
          const opponent = match.p1.ws === ws ? match.p2 : match.p1;
          send(opponent.ws, { type: 'opponent_disconnected' });
          activeMatches.delete(currentMatchId);
        }
      }
    }
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`);
  });
});

// Cleanup stale waiting players every 60s
setInterval(() => {
  for (const [key, player] of waitingPlayers.entries()) {
    if (player.ws.readyState !== player.ws.OPEN) {
      waitingPlayers.delete(key);
      log(`Cleaned up stale waiting player at stake=${key}`);
    }
  }
}, 60000);

server.listen(PORT, () => {
  log(`SolCrush matchmaking server running on port ${PORT}`);
});
