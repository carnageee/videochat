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

let localStream    = null;
let peerConnection = null;
let myRoom         = null;
let pendingCandidates = [];
let remoteStream   = null;

let config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function addMessage(text, type = 'system') {
  const msg = document.createElement('div');
  msg.classList.add('message', type);
  msg.textContent = text;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

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

// Start button
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

// Next button
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

// Disconnect button
disconnectBtn.addEventListener('click', () => {
  addMessage('You disconnected.', 'system');
  resetToIdle();
});

// Waiting for a partner
socket.on('waiting', () => {
  status.textContent = 'Waiting for someone to join...';
});

// Paired with someone
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

// Handle signals
socket.on('signal', async (data) => {
  if (!peerConnection) return;

  try {
    if (data.offer) {
      console.log('Received offer, creating answer...');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      // Flush any candidates that arrived before the offer
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
        // Flush any candidates that arrived before the answer
        for (const c of pendingCandidates) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCandidates = [];
      }

    } else if (data.candidate) {
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        // Queue candidate until remote description is set
        pendingCandidates.push(data.candidate);
      }
    }
  } catch (err) {
    console.error('Signal error:', err);
  }
});

// Stranger left
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

// Report button
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

// Send chat message
function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !myRoom) return;

  socket.emit('chat', { room: myRoom, text });
  addMessage(text, 'me');
  chatInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Receive chat message
socket.on('chat', ({ text }) => {
  addMessage(text, 'stranger');
});

// Online user count
socket.on('online_count', (count) => {
  document.getElementById('onlineCount').textContent = count + (count === 1 ? ' online' : ' online');
});

// If socket reconnects (e.g. phone woke from sleep), reset state so user can re-pair
socket.on('connect', () => {
  if (myRoom) {
    resetToIdle();
    addMessage('Connection was lost and restored. Press Start to reconnect.', 'system');
  }
});