const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const net = require('net');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const serverStartTime = Date.now();

// ---------------------------------------------------------------------------
// Express middleware & static files
// ---------------------------------------------------------------------------
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
    timestamp: new Date().toISOString(),
    registeredPcs: Object.keys(registeredPcs).length,
    connectedMobiles: Object.keys(mobilePcMap).length,
    port: PORT,
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// PC registration map:  pcId -> { socket, tcpHost, tcpPort }
//
// PRIMARY PATH:  Flutter mobile <--WebSocket--> C++ PC server (port 8080 direct)
//
// This Node.js server acts as an OPTIONAL RELAY for remote / internet
// connections where the mobile device and PC are NOT on the same LAN.
//
// How it works:
//   1. The C++ PC app (or a small companion script) connects to this server
//      and emits  `pc-register`  with  { pcId, tcpHost, tcpPort }
//   2. The Flutter mobile app connects and emits  `mobile-connect`  with
//      { pcId }  to be paired with that PC.
//   3. Commands from mobile are forwarded to the PC socket, and responses
//      are forwarded back.
//
// For LAN use:  Just connect Flutter directly to  ws://<PC_IP>:8080
// ---------------------------------------------------------------------------

/** @type {{ [pcId: string]: { socket: import('socket.io').Socket } }} */
const registeredPcs = {};

/** @type {{ [mobileSocketId: string]: string }} */  // mobileId -> pcId
const mobilePcMap = {};

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  console.log(`[+] Connected: ID=${socket.id} (IP: ${clientIp})`);

  // ---- PC registers itself as available for relay ----
  // Emitted by the PC companion / C++ bridge
  // payload: { pcId: string }
  socket.on('pc-register', (data) => {
    const pcId = (data && data.pcId) ? String(data.pcId) : socket.id;
    registeredPcs[pcId] = { socket };
    socket.data.role = 'pc';
    socket.data.pcId = pcId;
    socket.emit('pc-registered', { pcId });
    console.log(`[PC ] Registered with ID: ${pcId}`);
  });

  // ---- Mobile connects and selects a PC to relay through ----
  // payload: { pcId: string }
  socket.on('mobile-connect', (data) => {
    const pcId = data && data.pcId;
    if (!pcId || !registeredPcs[pcId]) {
      socket.emit('error', { message: `PC not found: ${pcId}` });
      return;
    }
    mobilePcMap[socket.id] = pcId;
    socket.data.role = 'mobile';
    socket.emit('mobile-connected', { pcId });
    console.log(`[MOB] ${socket.id} paired with PC ${pcId}`);
  });

  // ---- Relay: mobile -> PC (all control events) ----
  // The mobile app sends typed events; forward them to the paired PC.

  const relayToPc = (eventName, data) => {
    const pcId = mobilePcMap[socket.id];
    if (!pcId || !registeredPcs[pcId]) return;
    registeredPcs[pcId].socket.emit(eventName, data);
  };

  socket.on('trackpad-move',  (d) => relayToPc('trackpad-move', d));
  socket.on('mouse-click',    (d) => relayToPc('mouse-click',   d));
  socket.on('mouse-scroll',   (d) => relayToPc('mouse-scroll',  d));
  socket.on('volume-change',  (d) => {
    console.log(`[VOL] from ${socket.id}:`, d);
    relayToPc('volume-change', d);
  });
  socket.on('control-event',  (d) => {
    console.log(`[CTL] from ${socket.id}:`, d);
    relayToPc('control-event', d);
  });

  // ---- Relay: PC -> mobile (state updates, responses) ----
  socket.on('pc-state', (data) => {
    // PC broadcasts its state to any paired mobile clients
    const pcId = socket.data.pcId;
    if (!pcId) return;
    // Find all mobiles paired with this PC and emit to them
    for (const [mobileId, pid] of Object.entries(mobilePcMap)) {
      if (pid === pcId) {
        io.to(mobileId).emit('pc-state', data);
      }
    }
  });

  // ---- Disconnection ----
  socket.on('disconnect', (reason) => {
    const role = socket.data.role || 'unknown';
    console.log(`[-] Disconnected: ID=${socket.id} role=${role} (${reason})`);

    if (role === 'pc') {
      const pcId = socket.data.pcId;
      if (pcId) {
        delete registeredPcs[pcId];
        console.log(`[PC ] Unregistered: ${pcId}`);
      }
    } else if (role === 'mobile') {
      delete mobilePcMap[socket.id];
    }
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  console.log('===============================================');
  console.log(`  ZPC Relay Server running on port ${PORT}`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log('');
  console.log('  PRIMARY:  Flutter connects directly to C++ PC server');
  console.log('            ws://<PC_LAN_IP>:8080  (same network)');
  console.log('');
  console.log('  RELAY:    For remote/internet use, PC registers via');
  console.log('            pc-register event, mobile pairs via mobile-connect');
  console.log('===============================================');
});