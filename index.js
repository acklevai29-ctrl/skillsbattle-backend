const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SUPABASE_URL = 'https://adndxwbfkgyneqnkyfbb.supabase.co';
const SUPABASE_SECRET_KEY = 'sb_publishable_btxNtPha5Wtq3azIiDeg1g_oUgoqMKE';
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const GRID_SIZE = 30;
let waitingQueue = [];
let activeGames = {};

io.on('connection', (socket) => {
  socket.on('join_queue', async (data) => {
    const { userId, username, betAmount } = data;
    
    // Deduct balance logic here (omitted for brevity, keep from previous code)

    const player = { socketId: socket.id, userId, username, betAmount, color: '#' + Math.floor(Math.random()*16777215).toString(16) };
    
    if (waitingQueue.length > 0) {
      const opponent = waitingQueue.shift();
      const gameId = `game_${Date.now()}`;
      
      socket.join(gameId);
      io.sockets.sockets.get(opponent.socketId)?.join(gameId);

      startGame(gameId, [opponent, player]);
    } else {
      waitingQueue.push(player);
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('change_direction', (data) => {
    const { gameId, direction } = data;
    const game = activeGames[gameId];
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (player && player.alive) {
      // Prevent 180 degree turns
      if (player.direction === 'UP' && direction === 'DOWN') return;
      if (player.direction === 'DOWN' && direction === 'UP') return;
      if (player.direction === 'LEFT' && direction === 'RIGHT') return;
      if (player.direction === 'RIGHT' && direction === 'LEFT') return;
      player.nextDirection = direction;
    }
  });
});

function startGame(gameId, players) {
  const game = {
    gridSize: GRID_SIZE,
    food: { x: 15, y: 15 },
    players: players.map((p, i) => ({
      ...p,
      body: [{ x: 5, y: 5 + (i * 3) }],
      direction: 'RIGHT',
      nextDirection: 'RIGHT',
      alive: true
    })),
    status: 'playing'
  };
  
  activeGames[gameId] = game;
  io.to(gameId).emit('game_started', game);

  const tickRate = 120; // ms per frame

  const gameLoop = setInterval(() => {
    let aliveCount = 0;
    let winner = null;

    game.players.forEach(p => {
      if (!p.alive) return;
      aliveCount++;
      winner = p;

      p.direction = p.nextDirection;
      const head = { ...p.body[0] };

      if (p.direction === 'UP') head.y -= 1;
      if (p.direction === 'DOWN') head.y += 1;
      if (p.direction === 'LEFT') head.x -= 1;
      if (p.direction === 'RIGHT') head.x += 1;

      // Check wall collision
      if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
        p.alive = false;
        return;
      }

      // Check self collision
      if (p.body.some(seg => seg.x === head.x && seg.y === head.y)) {
        p.alive = false;
        return;
      }

      // Check collision with other players
      game.players.forEach(other => {
        if (other.socketId !== p.socketId && other.alive) {
          if (other.body.some(seg => seg.x === head.x && seg.y === head.y)) {
            p.alive = false;
          }
        }
      });

      if (!p.alive) return;

      p.body.unshift(head);

      // Check food
      if (head.x === game.food.x && head.y === game.food.y) {
        game.food = {
          x: Math.floor(Math.random() * GRID_SIZE),
          y: Math.floor(Math.random() * GRID_SIZE)
        };
      } else {
        p.body.pop(); // Remove tail if not eating
      }
    });

    io.to(gameId).emit('game_state', game);

    if (aliveCount <= 1) {
      clearInterval(gameLoop);
      io.to(gameId).emit('game_over', { winner: winner ? winner.username : 'Nobody' });
      delete activeGames[gameId];
    }
  }, tickRate);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Engine running on port ${PORT}`));
