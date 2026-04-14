const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://carnageee.github.io',
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

// ── 1-on-1 random pairing ──
const waitingQueue = [];

// ── Group rooms ──
// roomCode -> Set of socket IDs
const groupRooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function broadcastCount() {
  io.emit('online_count', io.engine.clientsCount);
}

io.on('connection', (socket) => {
  console.log('Someone connected:', socket.id);
  broadcastCount();

  // ── Random chat events ──

  socket.on('looking', async () => {
    const selfIndex = waitingQueue.indexOf(socket);
    if (selfIndex !== -1) waitingQueue.splice(selfIndex, 1);

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
      waitingQueue.push(socket);
      socket.emit('waiting');
      console.log('Waiting for a partner... Queue size:', waitingQueue.length);
    }
  });

  socket.on('signal', ({ room, data }) => {
    socket.to(room).emit('signal', data);
  });

  socket.on('chat', ({ room, text }) => {
    socket.to(room).emit('chat', { text });
  });

  socket.on('report', ({ room }) => {
    console.log(`REPORT filed — room: ${room}, reporter: ${socket.id}, time: ${new Date().toISOString()}`);
  });

  // ── Group room events ──

  socket.on('create-room', async ({ roomCode: requestedCode } = {}) => {
    let code = (requestedCode || '').trim().toUpperCase() || generateRoomCode();
    if (groupRooms.has(code)) {
      socket.emit('room-error', { message: 'Room code already in use. Try a different one.' });
      return;
    }
    groupRooms.set(code, new Set([socket.id]));
    socket.join('group:' + code);
    socket.emit('room-created', { roomCode: code });
    console.log('Group room created:', code, 'by', socket.id);
  });

  socket.on('join-room', async ({ roomCode }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = groupRooms.get(code);
    if (!room) {
      socket.emit('room-error', { message: 'Room not found. Check the code and try again.' });
      return;
    }
    if (room.size >= 12) {
      socket.emit('room-error', { message: 'Room is full (max 12 participants).' });
      return;
    }
    const existingPeers = [...room];
    room.add(socket.id);
    socket.join('group:' + code);

    const iceServers = await getTurnCredentials();

    // Tell the new joiner about who is already in the room
    socket.emit('room-joined', { roomCode: code, peers: existingPeers, iceServers });

    // Tell existing peers that someone new joined
    existingPeers.forEach(peerId => {
      io.to(peerId).emit('group-peer-joined', { peerId: socket.id, iceServers });
    });

    console.log('Joined group room:', code, socket.id, '— existing peers:', existingPeers.length);
  });

  // Route a WebRTC signal to a specific peer
  socket.on('group-signal', ({ roomCode, targetId, data }) => {
    io.to(targetId).emit('group-signal', { fromId: socket.id, data });
  });

  socket.on('group-chat', ({ roomCode, text }) => {
    socket.to('group:' + roomCode).emit('group-chat', { text, fromId: socket.id });
  });

  socket.on('leave-room', ({ roomCode }) => {
    const code = (roomCode || '').toUpperCase();
    const room = groupRooms.get(code);
    if (room && room.has(socket.id)) {
      room.delete(socket.id);
      socket.to('group:' + code).emit('group-peer-left', { peerId: socket.id });
      socket.leave('group:' + code);
      if (room.size === 0) {
        groupRooms.delete(code);
        console.log('Group room deleted (empty):', code);
      }
    }
  });

  // ── Disconnect ──

  socket.on('disconnect', () => {
    // Remove from 1-on-1 waiting queue
    const idx = waitingQueue.indexOf(socket);
    if (idx !== -1) waitingQueue.splice(idx, 1);

    // Notify peers in all rooms
    socket.rooms.forEach(room => {
      if (room === socket.id) return; // skip own socket room
      if (room.startsWith('group:')) {
        // Group room — notify remaining peers
        const code = room.slice(6);
        socket.to(room).emit('group-peer-left', { peerId: socket.id });
        const gRoom = groupRooms.get(code);
        if (gRoom) {
          gRoom.delete(socket.id);
          if (gRoom.size === 0) groupRooms.delete(code);
        }
      } else {
        // 1-on-1 room
        socket.to(room).emit('stranger_left');
      }
    });

    console.log('Someone disconnected:', socket.id);
    broadcastCount();
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
