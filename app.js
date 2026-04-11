const localVideo      = document.getElementById('localVideo');
const remoteVideo     = document.getElementById('remoteVideo');
const startBtn        = document.getElementById('startBtn');
const nextBtn         = document.getElementById('nextBtn');
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

const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: ['turn:numb.viagenie.ca'],
      username: 'webrtc@live.com',
      credential: 'muazkh'
    },
    {
      urls: ['turn:turn.bistri.com:80'],
      username: 'homeo',
      credential: 'homeo'
    },
    {
      urls: ['turn:turn.anyfirewall.com:443?transport=tcp'],
      username: 'webrtc',
      credential: 'webrtc'
    }
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