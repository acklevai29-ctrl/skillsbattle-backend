const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- PASTE YOUR SUPABASE KEYS HERE ---
const SUPABASE_URL = 'https://adndwbfgkyneqpykfyb.supabase.co';
const SUPABASE_SECRET_KEY = 'sb_secret_HDVsCvY8RGEjcvjfdTkjsw_jOoH_0e4';
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

let waitingQueue = [];

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join_queue', async (data) => {
    const { userId, username, betAmount } = data;
    
    // Check balance if not a bot
    if (!username.includes('bot')) {
      const { data: user } = await supabase.from('users').select('balance_usd').eq('id', userId).single();
      if (!user || user.balance_usd < betAmount) {
        return socket.emit('error_msg', 'Insufficient balance.');
      }
      // Deduct bet
      await supabase.from('users').update({ balance_usd: user.balance_usd - betAmount }).eq('id', userId);
    }

    const player = { socketId: socket.id, userId, username, betAmount, cashedOut: false };
    
    if (waitingQueue.length > 0) {
      const opponent = waitingQueue.shift();
      const lobbyId = `lobby_${Date.now()}`;
      
      socket.join(lobbyId);
      io.sockets.sockets.get(opponent.socketId)?.join(lobbyId);

      const lobbyData = { players: [opponent, player], pot: opponent.betAmount + player.betAmount, multiplier: 1.00 };
      
      io.to(lobbyId).emit('match_found', { players: lobbyData.players, pot: lobbyData.pot });
      startGame(lobbyId, lobbyData);
    } else {
      waitingQueue.push(player);
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('cashout', (lobbyId) => {
    const p = io.sockets.adapter.rooms.get(lobbyId);
    if(p) io.to(lobbyId).emit('player_cashed_out', socket.id);
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(p => p.socketId !== socket.id);
  });
});

function startGame(lobbyId, lobby) {
  io.to(lobbyId).emit('game_started');
  const crashPoint = (Math.random() * 3) + 1.1; 
  
  let tick = setInterval(async () => {
    lobby.multiplier += 0.05;
    io.to(lobbyId).emit('tick', lobby.multiplier);

    if (lobby.multiplier >= crashPoint) {
      clearInterval(tick);
      io.to(lobbyId).emit('game_crashed', crashPoint);
      
      // Logic for who wins goes here (simplified for now)
      // In a full version, you'd check who cashed out before crashPoint
      
      setTimeout(() => {
        io.to(lobbyId).emit('game_over', { message: 'Game over' });
      }, 2000);
    }
  }, 100);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Engine running on port ${PORT}`));
