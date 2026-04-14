const localVideo      = document.getElementById('localVideo');
const remoteVideo     = document.getElementById('remoteVideo');
const startBtn        = document.getElementById('startBtn');
const nextBtn         = document.getElementById('nextBtn');
const disconnectBtn   = document.getElementById('disconnectBtn');
const reportBtn       = document.getElementById('reportBtn');
const status          = document.getElementById('status');
const chatMessages    = document.getElementById('chatMessages');
const chatInput       = document.getElementById('chatInput');
const sendBtn         = document.getElementById('sendBtn');

const socket = io('https://videochat-production-5929.up.railway.app');

// ── Shared state ──
let localStream    = null;
let currentMode    = 'random'; // 'random' | 'group'

// ── Random mode state ──
let peerConnection    = null;
let myRoom            = null;
let pendingCandidates = [];
let remoteStream      = null;

let config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ── Group mode state ──
let myGroupRoom = null;
let groupConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
// peerId -> { pc: RTCPeerConnection, pendingCandidates: [] }
const groupPeers = new Map();

// ── Utilities ──

function addMessage(text, type = 'system') {
  const msg = document.createElement('div');
  msg.classList.add('message', type);
  msg.textContent = text;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Mode switching ──

document.getElementById('modeRandomBtn').addEventListener('click', () => switchMode('random'));
document.getElementById('modeGroupBtn').addEventListener('click', () => switchMode('group'));

function switchMode(mode) {
  if (mode === currentMode) return;

  // Clean up current mode before switching
  if (currentMode === 'random' && (peerConnection || localStream)) {
    resetToIdle();
  } else if (currentMode === 'group' && myGroupRoom) {
    socket.emit('leave-room', { roomCode: myGroupRoom });
    cleanupGroupRoom();
  }

  currentMode = mode;
  document.getElementById('modeRandomBtn').classList.toggle('mode-active', mode === 'random');
  document.getElementById('modeGroupBtn').classList.toggle('mode-active', mode === 'group');
  document.getElementById('randomView').style.display  = mode === 'random' ? 'flex'  : 'none';
  document.getElementById('groupView').style.display   = mode === 'group'  ? 'flex'  : 'none';
  document.getElementById('randomControls').style.display = mode === 'random' ? 'contents' : 'none';
  document.getElementById('groupControls').style.display  = mode === 'group'  ? 'contents' : 'none';

  if (mode === 'group') {
    status.textContent = 'Create or join a group room';
  } else {
    status.textContent = 'Press Start to find a stranger';
  }
}

// ── Random mode ──

function createPeerConnection(room) {
  const pc = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    console.log('ontrack fired! kind:', event.track.kind);
    if (!remoteStream) {
      remoteStream = event.streams?.[0] || new MediaStream();
      remoteVideo.srcObject = remoteStream;
      document.getElementById('remoteplaceholder').style.display = 'none';
    }
    if (!event.streams?.[0]) {
      remoteStream.addTrack(event.track);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate:', event.candidate.type, event.candidate.protocol);
      socket.emit('signal', { room, data: { candidate: event.candidate } });
    } else {
      console.log('ICE gathering complete');
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', pc.iceConnectionState);
    status.textContent = 'ICE: ' + pc.iceConnectionState;
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      status.textContent = 'Connected to a stranger!';
    }
    if (pc.iceConnectionState === 'failed') {
      console.error('ICE failed — no valid network path found');
      status.textContent = 'Connection failed. Try Next.';
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
  };

  return pc;
}

startBtn.addEventListener('click', async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    document.getElementById('localPlaceholder').style.display = 'none';

    status.textContent = 'Looking for a stranger...';
    startBtn.textContent = 'Searching...';
    startBtn.disabled = true;

    socket.emit('looking');

  } catch (err) {
    alert('Could not access camera. Please allow camera permission and try again.');
    console.error(err);
  }
});

function resetToIdle() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  remoteStream = null;
  myRoom = null;
  pendingCandidates = [];

  document.getElementById('remoteplaceholder').style.display = 'flex';
  document.getElementById('localPlaceholder').style.display = 'flex';

  chatInput.disabled     = true;
  sendBtn.disabled       = true;
  nextBtn.disabled       = true;
  disconnectBtn.disabled = true;
  reportBtn.disabled     = true;
  startBtn.disabled      = false;
  startBtn.textContent   = 'Start';
  status.textContent     = 'Press Start to find a stranger';
}

nextBtn.addEventListener('click', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  remoteVideo.srcObject = null;
  remoteStream = null;
  document.getElementById('remoteplaceholder').style.display = 'flex';
  myRoom = null;
  pendingCandidates = [];

  chatInput.disabled     = true;
  sendBtn.disabled       = true;
  nextBtn.disabled       = true;
  disconnectBtn.disabled = true;
  reportBtn.disabled     = true;
  status.textContent     = 'Looking for a new stranger...';

  addMessage('You skipped to the next stranger.', 'system');
  socket.emit('looking');
});

disconnectBtn.addEventListener('click', () => {
  addMessage('You disconnected.', 'system');
  resetToIdle();
});

socket.on('waiting', () => {
  status.textContent = 'Waiting for someone to join...';
});

socket.on('paired', async ({ room, isInitiator, iceServers }) => {
  myRoom = room;
  if (iceServers) {
    config = { iceServers };
    console.log('ICE servers from server:', JSON.stringify(iceServers, null, 2));
  } else {
    console.warn('No ICE servers received from server, using fallback STUN only');
  }
  status.textContent = 'Connected to a stranger!';
  startBtn.textContent = 'Connected';
  nextBtn.disabled       = false;
  chatInput.disabled     = false;
  sendBtn.disabled       = false;
  disconnectBtn.disabled = false;
  reportBtn.disabled     = false;
  addMessage('You are now connected to a stranger!', 'system');

  peerConnection = createPeerConnection(room);

  if (isInitiator) {
    console.log('I am the initiator, creating offer...');
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { room: myRoom, data: { offer } });
  } else {
    console.log('I am waiting for offer...');
  }
});

socket.on('signal', async (data) => {
  if (!peerConnection) return;

  try {
    if (data.offer) {
      console.log('Received offer, creating answer...');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      for (const c of pendingCandidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(c));
      }
      pendingCandidates = [];
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('signal', { room: myRoom, data: { answer } });

    } else if (data.answer) {
      console.log('Received answer, state:', peerConnection.signalingState);
      if (peerConnection.signalingState === 'have-local-offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        for (const c of pendingCandidates) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCandidates = [];
      }

    } else if (data.candidate) {
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        pendingCandidates.push(data.candidate);
      }
    }
  } catch (err) {
    console.error('Signal error:', err);
  }
});

socket.on('stranger_left', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  pendingCandidates = [];
  remoteStream = null;
  remoteVideo.srcObject = null;
  document.getElementById('remoteplaceholder').style.display = 'flex';
  status.textContent = 'Stranger disconnected. Press Start to find a new one.';
  startBtn.textContent = 'Start';
  startBtn.disabled    = false;
  nextBtn.disabled       = true;
  disconnectBtn.disabled = true;
  reportBtn.disabled     = true;
  chatInput.disabled     = true;
  sendBtn.disabled       = true;

  addMessage('Stranger has disconnected.', 'system');
});

reportBtn.addEventListener('click', () => {
  if (!myRoom) return;
  socket.emit('report', { room: myRoom });
  addMessage('You reported this user. Skipping...', 'system');
  reportBtn.disabled = true;

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  remoteStream = null;
  document.getElementById('remoteplaceholder').style.display = 'flex';
  myRoom = null;
  pendingCandidates = [];

  chatInput.disabled     = true;
  sendBtn.disabled       = true;
  nextBtn.disabled       = true;
  disconnectBtn.disabled = true;
  status.textContent     = 'Looking for a new stranger...';
  socket.emit('looking');
});

// ── Group mode ──

function createGroupPeerConnection(peerId) {
  const pc = new RTCPeerConnection(groupConfig);
  const pendingCands = [];

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    const stream = event.streams?.[0] || new MediaStream();
    addRemoteVideoTile(peerId, stream);
    if (!event.streams?.[0]) {
      const vid = document.getElementById('remote-vid-' + peerId);
      if (vid) vid.srcObject.addTrack(event.track);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('group-signal', {
        roomCode: myGroupRoom,
        targetId: peerId,
        data: { candidate: event.candidate }
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('Group peer', peerId, 'connection state:', pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removeRemoteVideoTile(peerId);
    }
  };

  groupPeers.set(peerId, { pc, pendingCands });
  return pc;
}

async function initGroupPeer(peerId, isInitiator) {
  const pc = createGroupPeerConnection(peerId);
  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('group-signal', {
      roomCode: myGroupRoom,
      targetId: peerId,
      data: { offer }
    });
  }
}

function addRemoteVideoTile(peerId, stream) {
  if (document.getElementById('tile-' + peerId)) return;
  const grid = document.getElementById('groupGrid');

  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrapper';
  wrapper.id = 'tile-' + peerId;

  const video = document.createElement('video');
  video.id = 'remote-vid-' + peerId;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;

  const label = document.createElement('div');
  label.className = 'video-label';
  label.textContent = 'Participant';

  wrapper.appendChild(video);
  wrapper.appendChild(label);
  grid.appendChild(wrapper);
}

function removeRemoteVideoTile(peerId) {
  const tile = document.getElementById('tile-' + peerId);
  if (tile) tile.remove();
  const entry = groupPeers.get(peerId);
  if (entry) {
    entry.pc.close();
    groupPeers.delete(peerId);
  }
}

function cleanupGroupRoom() {
  groupPeers.forEach((_, peerId) => removeRemoteVideoTile(peerId));
  groupPeers.clear();

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  // Clear local tile video
  const localGroupVid = document.getElementById('localGroupVideo');
  if (localGroupVid) localGroupVid.srcObject = null;
  document.getElementById('localGroupPlaceholder').style.display = 'flex';

  myGroupRoom = null;
  document.getElementById('groupRoomInfo').style.display = 'none';
  document.getElementById('groupGrid').style.display = 'none';
  document.getElementById('groupSetup').style.display = 'flex';
  document.getElementById('leaveRoomBtn').disabled = true;
  document.getElementById('roomCodeInput').value = '';
  chatInput.disabled = true;
  sendBtn.disabled   = true;
  status.textContent = 'Create or join a group room';
}

function onRoomReady(roomCode) {
  myGroupRoom = roomCode;
  document.getElementById('displayedRoomCode').textContent = roomCode;
  document.getElementById('groupRoomInfo').style.display = 'flex';
  document.getElementById('groupSetup').style.display = 'none';
  document.getElementById('groupGrid').style.display = 'grid';
  document.getElementById('leaveRoomBtn').disabled = false;
  chatInput.disabled = false;
  sendBtn.disabled   = false;
  status.textContent = 'In room: ' + roomCode;

  // Show local video in the group grid
  const localGroupVid = document.getElementById('localGroupVideo');
  localGroupVid.srcObject = localStream;
  document.getElementById('localGroupPlaceholder').style.display = 'none';
}

async function startCameraForGroup() {
  if (localStream) return true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    return true;
  } catch (err) {
    alert('Could not access camera. Please allow camera permission and try again.');
    console.error(err);
    return false;
  }
}

document.getElementById('createRoomBtn').addEventListener('click', async () => {
  if (!await startCameraForGroup()) return;
  socket.emit('create-room', {});
});

document.getElementById('joinRoomBtn').addEventListener('click', async () => {
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) { alert('Enter a room code first.'); return; }
  if (!await startCameraForGroup()) return;
  socket.emit('join-room', { roomCode: code });
});

document.getElementById('roomCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('joinRoomBtn').click();
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => {
  if (myGroupRoom) socket.emit('leave-room', { roomCode: myGroupRoom });
  cleanupGroupRoom();
  addMessage('You left the room.', 'system');
});

document.getElementById('copyCodeBtn').addEventListener('click', () => {
  const code = document.getElementById('displayedRoomCode').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('copyCodeBtn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
});

// ── Group socket events ──

socket.on('room-created', ({ roomCode }) => {
  onRoomReady(roomCode);
  addMessage('Room created! Share this code with friends: ' + roomCode, 'system');
});

socket.on('room-joined', async ({ roomCode, peers, iceServers }) => {
  if (iceServers) groupConfig = { iceServers };
  onRoomReady(roomCode);
  const n = peers.length;
  addMessage('Joined room ' + roomCode + (n > 0 ? ` — connecting to ${n} participant${n > 1 ? 's' : ''}...` : ' — you\'re the first one here!'), 'system');
  // New joiner initiates connections to all existing peers
  for (const peerId of peers) {
    await initGroupPeer(peerId, true);
  }
});

socket.on('group-peer-joined', async ({ peerId, iceServers }) => {
  if (iceServers) groupConfig = { iceServers };
  addMessage('Someone joined the room.', 'system');
  // Existing peer waits for offer from the new joiner
  createGroupPeerConnection(peerId);
});

socket.on('group-signal', async ({ fromId, data }) => {
  const entry = groupPeers.get(fromId);
  if (!entry) return;
  const { pc, pendingCands } = entry;

  try {
    if (data.offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      for (const c of pendingCands) {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      }
      pendingCands.length = 0;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('group-signal', {
        roomCode: myGroupRoom,
        targetId: fromId,
        data: { answer }
      });

    } else if (data.answer) {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        for (const c of pendingCands) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCands.length = 0;
      }

    } else if (data.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        pendingCands.push(data.candidate);
      }
    }
  } catch (err) {
    console.error('Group signal error:', err);
  }
});

socket.on('group-peer-left', ({ peerId }) => {
  removeRemoteVideoTile(peerId);
  addMessage('A participant left the room.', 'system');
});

socket.on('group-chat', ({ text }) => {
  addMessage(text, 'stranger');
});

socket.on('room-error', ({ message }) => {
  addMessage('Error: ' + message, 'system');
  status.textContent = message;
});

// ── Chat (shared) ──

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  if (currentMode === 'group' && myGroupRoom) {
    socket.emit('group-chat', { roomCode: myGroupRoom, text });
    addMessage(text, 'me');
    chatInput.value = '';
  } else if (currentMode === 'random' && myRoom) {
    socket.emit('chat', { room: myRoom, text });
    addMessage(text, 'me');
    chatInput.value = '';
  }
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

socket.on('chat', ({ text }) => {
  addMessage(text, 'stranger');
});

// ── Online count ──

socket.on('online_count', (count) => {
  document.getElementById('onlineCount').textContent = count + ' online';
});

// ── Reconnect handling ──

socket.on('connect', () => {
  if (myRoom) {
    resetToIdle();
    addMessage('Connection was lost and restored. Press Start to reconnect.', 'system');
  }
  if (myGroupRoom) {
    cleanupGroupRoom();
    addMessage('Connection was lost. Please rejoin the room.', 'system');
  }
});
