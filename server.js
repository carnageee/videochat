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

const XIRSYS_IDENT  = process.env.XIRSYS_IDENT  || 'eggybud';
const XIRSYS_SECRET = process.env.XIRSYS_SECRET || '63f13030-35c7-11f1-9faa-0242ac130002';
const XIRSYS_CHANNEL = 'empirevideo';

async function getTurnCredentials() {
  try {
    const auth = Buffer.from(`${XIRSYS_IDENT}:${XIRSYS_SECRET}`).toString('base64');
    const res = await fetch(`https://global.xirsys.net/_turn/${XIRSYS_CHANNEL}`, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ format: 'urls' })
    });
    const data = await res.json();
    const iceServers = data.v.iceServers;
    console.log('Fetched Xirsys TURN credentials:', iceServers.length, 'servers');
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

app.get('/ice', async (req, res) => {
  const servers = await getTurnCredentials();
  res.json(servers);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});