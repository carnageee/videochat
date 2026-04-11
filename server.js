const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://empirevideo.netlify.app',
    methods: ['GET', 'POST']
  }
});

const METERED_API_KEY = process.env.METERED_API_KEY || 'f_xPQX8pPRkPhdaZoW-HeOI8w4i0Mgufjh1-7q3420wFGN75';
const METERED_APP_URL = 'https://empirevideo.metered.live/api/v1/turn/credentials';

async function getTurnCredentials() {
  try {
    const res = await fetch(`${METERED_APP_URL}?apiKey=${METERED_API_KEY}`);
    const iceServers = await res.json();
    console.log('Fetched TURN credentials:', iceServers.length, 'servers');
    return iceServers;
  } catch (err) {
    console.error('Failed to fetch TURN credentials:', err);
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }
}

let waitingUser = null;

io.on('connection', (socket) => {
  console.log('Someone connected:', socket.id);

  socket.on('looking', async () => {
  // Try to pair this user with someone waiting
  if (waitingUser) {
    // There's someone waiting — pair them together
    const room = waitingUser.id + '#' + socket.id;

    socket.join(room);
    waitingUser.join(room);

    const iceServers = await getTurnCredentials();

    // Tell both users they are paired
    waitingUser.emit('paired', { room, isInitiator: true, iceServers });
    socket.emit('paired', { room, isInitiator: false, iceServers });

    console.log('Paired:', room);
    waitingUser = null;

  } else {
    // Nobody waiting yet — this user waits
    waitingUser = socket;
    socket.emit('waiting');
    console.log('Waiting for a partner...');
  }
  }); // end of looking event

  // Relay signaling messages between the two users
  socket.on('signal', ({ room, data }) => {
    socket.to(room).emit('signal', data);
  });

  // Handle disconnect
  // Relay chat messages
  socket.on('chat', ({ room, text }) => {
    socket.to(room).emit('chat', { text });
  });
socket.on('disconnect', () => {
    if (waitingUser === socket) {
      waitingUser = null;
    }
    // Notify the other person in the room
    socket.rooms.forEach(room => {
      socket.to(room).emit('stranger_left');
    });
    console.log('Someone disconnected:', socket.id);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});