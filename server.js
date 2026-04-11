const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

let waitingUser = null;

io.on('connection', (socket) => {
  console.log('Someone connected:', socket.id);

  socket.on('looking', () => {
  // Try to pair this user with someone waiting
  if (waitingUser) {
    // There's someone waiting — pair them together
    const room = waitingUser.id + '#' + socket.id;

    socket.join(room);
    waitingUser.join(room);

    // Tell both users they are paired
    io.to(room).emit('paired', { room });

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