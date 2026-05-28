const express = require("express");
const https = require("http");  // returned to http in prod
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();

// for mkcert
const sslOptions = {
  key: fs.readFileSync("localhost+1-key.pem"),
  cert: fs.readFileSync("localhost+1.pem"),
};

const server = https.createServer(/*sslOptions, */app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;;
const MAX_USERS_PER_ROOM = 20;

// rooms : { roomId: { [socketId]: { id, username } } }
const rooms = {};

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log(`[+] connecté : ${socket.id}`);

  // ── JOIN ROOM ──────────────────────────────────────────────
  socket.on("join-room", ({ roomId, username }) => {
    if (!rooms[roomId]) rooms[roomId] = {};

    if (Object.keys(rooms[roomId]).length >= MAX_USERS_PER_ROOM) {
      socket.emit("room-full");
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;
    rooms[roomId][socket.id] = { id: socket.id, username };

    // envoyer la liste des pairs déjà présents
    const peers = Object.values(rooms[roomId]).filter((p) => p.id !== socket.id);
    socket.emit("room-joined", { roomId, peers, myId: socket.id });

    // notifier les autres
    socket.to(roomId).emit("peer-joined", { id: socket.id, username });

    console.log(`[room:${roomId}] ${username} rejoint (${Object.keys(rooms[roomId]).length}/${MAX_USERS_PER_ROOM})`);
  });

  // ── SIGNALISATION WebRTC ───────────────────────────────────
  socket.on("offer", ({ to, offer }) => {
    io.to(to).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ to, answer }) => {
    io.to(to).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  // ── CHAT / CANAL DATA ──────────────────────────────────────
  socket.on("chat-message", ({ roomId, message }) => {
    io.to(roomId).emit("chat-message", {
      from: socket.id,
      username: socket.username,
      message,
      ts: Date.now(),
    });
  });

  // ── PHOTO (metadata seulement, les pixels restent côté client) ──
  socket.on("photo-taken", ({ roomId, photoId }) => {
    socket.to(roomId).emit("peer-photo", {
      from: socket.id,
      username: socket.username,
      photoId,
    });
  });

  // ── DISCONNECT ─────────────────────────────────────────────
  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId][socket.id];
      socket.to(roomId).emit("peer-left", { id: socket.id });
      if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId];
      console.log(`[-] ${socket.username || socket.id} a quitté room:${roomId}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Serveur WebRTC démarré → http://localhost:${PORT}`);
});