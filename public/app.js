const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let socket;
let localStream;
let myId;
let myUsername;
let currentRoom;
let micOn = true;
let camOn = true;

// peerId → { pc: RTCPeerConnection, stream: MediaStream }
const peers = {};

// ── JOIN ──────────────────────────────────────────────────────
async function joinRoom() {
  const username = document.getElementById("input-username").value.trim();
  const roomId   = document.getElementById("input-room").value.trim();
  if (!username || !roomId) return alert("Nom et room requis.");

  myUsername  = username;
  currentRoom = roomId;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    alert("Impossible d'accéder à la caméra/micro : " + e.message);
    return;
  }

  addLocalVideo();

  socket = io();
  bindSocketEvents();
  socket.emit("join-room", { roomId, username });
}

// ── LOCAL VIDEO ───────────────────────────────────────────────
function addLocalVideo() {
  const tile = createTile("local", myUsername + " (moi)");
  tile.querySelector("video").srcObject = localStream;
  document.getElementById("video-grid").appendChild(tile);
  document.getElementById("join-screen").style.display = "none";
  document.getElementById("app").style.display        = "flex";
  document.getElementById("room-label").textContent   = "room: " + currentRoom;
}

// ── SOCKET EVENTS ─────────────────────────────────────────────
function bindSocketEvents() {
  socket.on("room-joined", ({ peers: existingPeers, myId: id }) => {
    myId = id;
    existingPeers.forEach((peer) => {
      addParticipant(peer.id, peer.username);
      startCall(peer.id);          // on initie l'offre vers chaque pair existant
    });
  });

  socket.on("peer-joined", ({ id, username }) => {
    addParticipant(id, username);
    // le nouveau pair attend nos offres — on n'initie pas ici (il le fera)
  });

  socket.on("offer", async ({ from, offer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { to: from, answer });
  });

  socket.on("answer", async ({ from, answer }) => {
    const pc = peers[from]?.pc;
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on("ice-candidate", async ({ from, candidate }) => {
    const pc = peers[from]?.pc;
    if (pc && candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    }
  });

  socket.on("peer-left", ({ id }) => {
    closePeer(id);
    removeParticipant(id);
  });

  socket.on("room-full", () => alert("La room est pleine (20 participants max)."));

  socket.on("chat-message", ({ from, username, message, ts }) => {
    appendChat(username, message, ts);
  });

  socket.on("peer-photo", ({ from, username }) => {
    appendChat("système", `${username} a pris une photo 📸`, Date.now());
  });
}

// ── PEER CONNECTION ───────────────────────────────────────────
function getOrCreatePC(peerId) {
  if (peers[peerId]) return peers[peerId].pc;

  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[peerId] = { pc, stream: null };

  // ajouter les tracks locaux
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("ice-candidate", { to: peerId, candidate });
  };

  // flux distant
  pc.ontrack = ({ streams }) => {
    peers[peerId].stream = streams[0];
    const username = getUsername(peerId);
    const existing = document.getElementById("tile-" + peerId);
    if (existing) {
      existing.querySelector("video").srcObject = streams[0];
    } else {
      const tile = createTile(peerId, username);
      tile.querySelector("video").srcObject = streams[0];
      document.getElementById("video-grid").appendChild(tile);
    }
  };

  pc.onconnectionstatechange = () => {
    if (["disconnected","failed","closed"].includes(pc.connectionState)) {
      closePeer(peerId);
    }
  };

  return pc;
}

async function startCall(peerId) {
  const pc    = getOrCreatePC(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { to: peerId, offer });
}

function closePeer(peerId) {
  if (peers[peerId]) {
    peers[peerId].pc.close();
    delete peers[peerId];
  }
  const tile = document.getElementById("tile-" + peerId);
  if (tile) tile.remove();
}

// ── UI HELPERS ────────────────────────────────────────────────
function createTile(id, label) {
  const tile  = document.createElement("div");
  tile.className = "video-tile";
  tile.id        = "tile-" + id;

  const video = document.createElement("video");
  video.autoplay   = true;
  video.playsinline = true;
  if (id === "local") video.muted = true;

  const lbl  = document.createElement("div");
  lbl.className   = "label";
  lbl.textContent = label || id;

  const micon = document.createElement("div");
  micon.className   = "muted-icon";
  micon.textContent = "🔇";

  tile.appendChild(video);
  tile.appendChild(lbl);
  tile.appendChild(micon);
  return tile;
}

function addParticipant(id, username) {
  // store username on element for later lookup
  const tile = document.getElementById("tile-" + id);
  if (tile) tile.dataset.username = username;

  const list = document.getElementById("participants-list");
  if (document.getElementById("part-" + id)) return;
  const item = document.createElement("div");
  item.className = "participant-item";
  item.id        = "part-" + id;
  item.innerHTML = `<span class="dot"></span><span>${username}</span>`;
  list.appendChild(item);
}

function removeParticipant(id) {
  document.getElementById("part-" + id)?.remove();
}

function getUsername(peerId) {
  const el = document.getElementById("part-" + peerId);
  return el ? el.querySelector("span:last-child").textContent : peerId;
}

// ── CONTROLS ─────────────────────────────────────────────────
function toggleMic() {
  micOn = !micOn;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
  const btn = document.getElementById("btn-mic");
  btn.textContent = micOn ? "🎤 Micro" : "🔇 Micro";
  btn.classList.toggle("active", micOn);
}

function toggleCam() {
  camOn = !camOn;
  localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
  const btn = document.getElementById("btn-cam");
  btn.textContent = camOn ? "📷 Caméra" : "🚫 Caméra";
  btn.classList.toggle("active", camOn);
}

function leaveRoom() {
  Object.keys(peers).forEach(closePeer);
  localStream?.getTracks().forEach((t) => t.stop());
  socket?.disconnect();
  location.reload();
}

// ── CHAT ──────────────────────────────────────────────────────
function sendChat() {
  const input = document.getElementById("chat-input");
  const msg   = input.value.trim();
  if (!msg) return;
  socket.emit("chat-message", { roomId: currentRoom, message: msg });
  appendChat(myUsername, msg, Date.now(), true);
  input.value = "";
}

function appendChat(username, message, ts, self = false) {
  const box  = document.getElementById("chat-messages");
  const div  = document.createElement("div");
  div.className = "chat-msg";
  const time = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `<span class="who">${username}</span><span class="time">${time}</span><br>${message}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// ── PHOTO (déclenché depuis index.html, traitement dans photo.js) ──
function takePhoto() {
  const video = document.querySelector("#tile-local video");
  if (!video) return;
  window._takePhotoFromVideo(video, currentRoom, socket, myUsername);
}

// ── TAB SWITCH ────────────────────────────────────────────────
function switchTab(name, btn) {
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll("#sidebar-tabs button").forEach((b) => b.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  btn.classList.add("active");
}