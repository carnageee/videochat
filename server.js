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

const XIRSYS_IDENT  = process.env.XIRSYS_IDENT;
const XIRSYS_SECRET = process.env.XIRSYS_SECRET;
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
    const raw = data.v.iceServers;
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      ...(Array.isArray(raw) ? raw : [raw])
    ];
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

const waitingQueue = [];

io.on('connection', (socket) => {
  console.log('Someone connected:', socket.id);

  socket.on('looking', async () => {
    // Remove self from queue in case of re-queue (e.g. Next button)
    const selfIndex = waitingQueue.indexOf(socket);
    if (selfIndex !== -1) waitingQueue.splice(selfIndex, 1);

    // Try to pair with the first person in the queue
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const room = partner.id + '#' + socket.id;

      socket.join(room);
      partner.join(room);

      const iceServers = await getTurnCredentials();

      partner.emit('paired', { room, isInitiator: true, iceServers });
      socket.emit('paired', { room, isInitiator: false, iceServers });

      console.log('Paired:', room);
    } else {
      // Nobody waiting yet — join the queue
      waitingQueue.push(socket);
      socket.emit('waiting');
      console.log('Waiting for a partner... Queue size:', waitingQueue.length);
    }
  }); // end of looking event

  // Relay signaling messages between the two users
  socket.on('signal', ({ room, data }) => {
    socket.to(room).emit('signal', data);
  });

  socket.on('chat', ({ room, text }) => {
    socket.to(room).emit('chat', { text });
  });

  socket.on('report', ({ room }) => {
    console.log(`REPORT filed — room: ${room}, reporter: ${socket.id}, time: ${new Date().toISOString()}`);
  });

  socket.on('disconnect', () => {
    const idx = waitingQueue.indexOf(socket);
    if (idx !== -1) waitingQueue.splice(idx, 1);
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