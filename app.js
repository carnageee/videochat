const localVideo      = document.getElementById('localVideo');
const remoteVideo     = document.getElementById('remoteVideo');
const startBtn        = document.getElementById('startBtn');
const nextBtn         = document.getElementById('nextBtn');
const status          = document.getElementById('status');
const chatMessages    = document.getElementById('chatMessages');
const chatInput       = document.getElementById('chatInput');
const sendBtn         = document.getElementById('sendBtn');
const remoteHolder    = document.getElementById('remoteplaceholder');
const localPlaceholder  = document.getElementById('localPlaceholder');
const remotePlaceholder = document.getElementById('remoteplaceholder');

const socket = io('videochat-production-5929.up.railway.app');

let localStream    = null;
let peerConnection = null;
let myRoom         = null;

const config = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function addMessage(text, type = 'system') {
  const msg = document.createElement('div');
  msg.classList.add('message', type);
  msg.textContent = text;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function startPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    document.getElementById('remoteplaceholder').style.display = 'none';
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { room: myRoom, data: { candidate: event.candidate } });
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('signal', { room: myRoom, data: { offer } });
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

// Next button
nextBtn.addEventListener('click', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  remoteVideo.srcObject = null;
  document.getElementById('remoteplaceholder').style.display = 'flex';
  myRoom = null;

  chatInput.disabled = true;
  sendBtn.disabled   = true;
  nextBtn.disabled   = true;
  status.textContent = 'Looking for a new stranger...';

  addMessage('You skipped to the next stranger.', 'system');
  socket.emit('looking');
});

// Waiting for a partner
socket.on('waiting', () => {
  status.textContent = 'Waiting for someone to join...';
});

// Paired with someone
socket.on('paired', async ({ room, isInitiator }) => {
  myRoom = room;
  status.textContent = 'Connected to a stranger!';
  startBtn.textContent = 'Connected';
  nextBtn.disabled = false;
  chatInput.disabled = false;
  sendBtn.disabled   = false;

  addMessage('You are now connected to a stranger!', 'system');

  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    document.getElementById('remoteplaceholder').style.display = 'none';
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { room: myRoom, data: { candidate: event.candidate } });
    }
  };

  // Only the initiator creates the offer
  if (isInitiator) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { room: myRoom, data: { offer } });
  }
});

// Handle signals
socket.on('signal', async (data) => {
  if (!peerConnection) return;

  try {
    if (data.offer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('signal', { room: myRoom, data: { answer } });

    } else if (data.answer) {
      // Only set answer if we're in the right state
      if (peerConnection.signalingState === 'have-local-offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }

    } else if (data.candidate) {
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
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

  remoteVideo.srcObject = null;
  document.getElementById('remoteplaceholder').style.display = 'flex';
  status.textContent = 'Stranger disconnected. Press Start to find a new one.';
  startBtn.textContent = 'Start Chatting';
  startBtn.disabled  = false;
  nextBtn.disabled   = true;
  chatInput.disabled = true;
  sendBtn.disabled   = true;

  addMessage('Stranger has disconnected.', 'system');
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