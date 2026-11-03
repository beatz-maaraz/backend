const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const net = require('net');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
let serverStartTime = Date.now();
let isRestarting = false;

// ---------------------------------------------------------------------------
// Express middleware & static files
// ---------------------------------------------------------------------------
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getLocalIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const devName of Object.keys(interfaces)) {
      for (const iface of interfaces[devName]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (_) {}
  return '127.0.0.1';
}

function formatFullIp(ip) {
  if (!ip) return '127.0.0.1';
  let clean = String(ip).trim();
  if (clean.startsWith('::ffff:')) {
    clean = clean.replace('::ffff:', '');
  }
  if (clean === '::1' || clean === '127.0.0.1') {
    return '127.0.0.1 (Localhost)';
  }
  return clean;
}

// HTTP REST command endpoint for mobile (fallback when WebSockets are blocked)
app.post('/api/command', (req, res) => {
  const { pcId, roomId, event, data, action } = req.body || {};
  let targetId = pcId || roomId;
  const activePcIds = Object.keys(registeredPcs);
  if (!targetId && activePcIds.length === 1) {
    targetId = activePcIds[0];
  }
  if (!targetId || !registeredPcs[targetId]) {
    return res.status(404).json({
      status: 'error',
      message: `Target PC/Room not found: ${targetId || 'none'}`,
      availableRooms: activePcIds
    });
  }

  const eventName = event || 'control-event';
  const payload = data || { action };
  try {
    registeredPcs[targetId].socket.emit(eventName, payload);
    res.json({ status: 'ok', deliveredTo: targetId });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/health', (req, res) => {
  const pcList = Object.keys(registeredPcs).map(id => ({
    id,
    roomId: id,
    name: registeredPcs[id].pcName || id,
    type: registeredPcs[id].deviceType || 'laptop',
    role: 'pc',
    ip: registeredPcs[id].ip,
    connectedAt: registeredPcs[id].connectedAt,
    pairedMobilesCount: Object.values(mobilePcMap).filter(pid => pid === id).length,
  }));

  const mobileList = Object.keys(connectedMobiles).map(id => {
    const pairedId = connectedMobiles[id].pairedPcId || mobilePcMap[id] || null;
    const pairedPc = pairedId && registeredPcs[pairedId];
    const devName = connectedMobiles[id].deviceName || 'Mobile Device';
    return {
      id,
      name: devName,
      mobileName: devName,
      type: connectedMobiles[id].deviceType || 'mobile',
      role: 'mobile',
      roomId: pairedId,
      pairedWith: pairedId,
      pairedPcName: pairedPc ? (pairedPc.pcName || pairedId) : (pairedId ? `Room #${pairedId}` : null),
      ip: connectedMobiles[id].ip,
      connectedAt: connectedMobiles[id].connectedAt,
    };
  });

  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
    timestamp: new Date().toISOString(),
    registeredPcs: pcList.length,
    connectedMobiles: mobileList.length,
    totalDevices: pcList.length + mobileList.length,
    port: PORT,
    serverIp: getLocalIp(),
    devices: [...pcList, ...mobileList],
  });
});

app.get('/api/devices', (req, res) => {
  const pcList = Object.keys(registeredPcs).map(id => ({
    id,
    roomId: id,
    name: registeredPcs[id].pcName || id,
    type: registeredPcs[id].deviceType || 'laptop',
    role: 'pc',
    ip: registeredPcs[id].ip,
    connectedAt: registeredPcs[id].connectedAt,
    pairedMobilesCount: Object.values(mobilePcMap).filter(pid => pid === id).length,
  }));

  const mobileList = Object.keys(connectedMobiles).map(id => {
    const pairedId = connectedMobiles[id].pairedPcId || mobilePcMap[id] || null;
    const pairedPc = pairedId && registeredPcs[pairedId];
    const devName = connectedMobiles[id].deviceName || 'Mobile Device';
    return {
      id,
      name: devName,
      mobileName: devName,
      type: connectedMobiles[id].deviceType || 'mobile',
      role: 'mobile',
      roomId: pairedId,
      pairedWith: pairedId,
      pairedPcName: pairedPc ? (pairedPc.pcName || pairedId) : (pairedId ? `Room #${pairedId}` : null),
      ip: connectedMobiles[id].ip,
      connectedAt: connectedMobiles[id].connectedAt,
    };
  });

  res.json({
    status: 'ok',
    serverIp: getLocalIp(),
    port: PORT,
    total: pcList.length + mobileList.length,
    devices: [...pcList, ...mobileList]
  });
});

// Endpoint to list online PCs for mobile auto-discovery
app.get('/pcs', (req, res) => {
  const pcs = Object.keys(registeredPcs).map(id => ({
    id,
    pcName: registeredPcs[id].pcName || id,
    version: registeredPcs[id].version || '2.0',
    connectedAt: registeredPcs[id].connectedAt || new Date().toISOString(),
  }));
  res.json({ status: 'ok', pcs, count: pcs.length });
});

app.get('/api/pcs', (req, res) => {
  res.redirect('/pcs');
});

// Reset server state without killing the process
app.post('/api/reset', (req, res) => {
  console.log('[!] Server state reset requested');
  try {
    io.disconnectSockets(true);
  } catch (_) {}

  for (const key of Object.keys(registeredPcs)) delete registeredPcs[key];
  for (const key of Object.keys(mobilePcMap)) delete mobilePcMap[key];
  for (const key of Object.keys(connectedMobiles)) delete connectedMobiles[key];

  serverStartTime = Date.now();

  res.json({
    status: 'ok',
    message: 'Server state and connected devices reset successfully',
    timestamp: new Date().toISOString()
  });
});

// Full server process restart
app.post('/api/restart', (req, res) => {
  if (isRestarting) {
    return res.status(429).json({ status: 'error', message: 'Server is already restarting' });
  }
  isRestarting = true;
  console.log('[!] Server process restart requested');

  res.json({
    status: 'ok',
    message: 'Server is restarting now. Reconnecting shortly...'
  });

  // Disconnect sockets and gracefully trigger restart
  setTimeout(() => {
    try {
      io.disconnectSockets(true);
    } catch (_) {}

    server.close(() => {
      console.log('[*] Closed HTTP server. Spawning new process...');
      const child = spawn(process.execPath, process.argv.slice(1), {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      process.exit(0);
    });

    // Fallback exit after 1.5s if keepalive sockets delay server.close()
    setTimeout(() => {
      const child = spawn(process.execPath, process.argv.slice(1), {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      process.exit(0);
    }, 1500);
  }, 300);
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

/** @type {{ [pcId: string]: { socket: import('socket.io').Socket, pcName: string, deviceType: string, version: string, ip: string, connectedAt: string } }} */
const registeredPcs = {};

/** @type {{ [mobileSocketId: string]: string }} */  // mobileId -> pcId
const mobilePcMap = {};

/** @type {{ [mobileSocketId: string]: { socket: import('socket.io').Socket, deviceName: string, deviceType: string, pairedPcId: string, ip: string, connectedAt: string } }} */
const connectedMobiles = {};

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  const clientIp = formatFullIp(socket.handshake.address);
  console.log(`[+] Connected: ID=${socket.id} (IP: ${clientIp})`);

  // Detect pre-configured mobile clients via query string
  const query = socket.handshake.query || {};
  if (query.role === 'mobile' || query.mobileName || query.deviceName) {
    const devName = String(query.mobileName || query.deviceName || query.name || query.model || `Mobile (${socket.id.slice(0, 5)})`);
    const devType = String(query.deviceType || 'mobile').toLowerCase();
    const roomId = query.roomId || query.pcId || null;
    connectedMobiles[socket.id] = {
      socket,
      deviceName: devName,
      deviceType: devType,
      pairedPcId: roomId,
      ip: clientIp,
      connectedAt: new Date().toISOString(),
    };
    socket.data.role = 'mobile';
    socket.data.deviceName = devName;
    if (roomId) mobilePcMap[socket.id] = roomId;
  }

  // ---- PC registers itself as available for relay ----
  // Supports both 'pc-register' and 'register_pc'
  const handlePcRegister = (data) => {
    const pcId = (data && (data.pcId || data.roomId)) ? String(data.pcId || data.roomId) : socket.id;
    const pcName = (data && (data.pcName || data.name || data.deviceName)) 
      ? String(data.pcName || data.name || data.deviceName) 
      : (pcId.startsWith('pc-') ? pcId : `PC (${pcId.slice(0, 6)})`);
    const deviceType = (data && (data.deviceType || data.type)) 
      ? String(data.deviceType || data.type).toLowerCase() 
      : 'laptop';
    const version = (data && data.version) ? String(data.version) : '2.0';
    
    registeredPcs[pcId] = {
      socket,
      pcName,
      deviceType,
      version,
      ip: clientIp,
      connectedAt: new Date().toISOString(),
    };
    socket.data.role = 'pc';
    socket.data.pcId = pcId;

    // Emit both confirmations for compatibility
    socket.emit('pc-registered', { pcId, roomId: pcId });
    socket.emit('registered', { pcId, roomId: pcId });
    console.log(`[PC ] Registered: ID=${pcId} Name="${pcName}" Type="${deviceType}"`);
  };

  socket.on('pc-register', handlePcRegister);
  socket.on('register_pc', handlePcRegister);
  socket.on('register', handlePcRegister);

  // ---- Mobile connects and selects a PC / Room to relay through ----
  // Supports 'mobile-connect', 'connect_pc', 'join_room', 'register_mobile'
  const handleMobileConnect = (rawData) => {
    let data = rawData;
    if (typeof rawData === 'string') {
      try { data = JSON.parse(rawData); } catch (_) {}
    }

    const activePcIds = Object.keys(registeredPcs);
    let requestedId = (data && (data.pcId || data.roomId)) ? String(data.pcId || data.roomId) : null;
    
    // Auto-detect PC if there is only 1 PC registered and mobile didn't provide pcId
    if (!requestedId && activePcIds.length === 1) {
      requestedId = activePcIds[0];
    }

    let targetPcId = requestedId;

    // If requestedId not exact match, try case-insensitive or partial match
    if (targetPcId && !registeredPcs[targetPcId]) {
      const lower = targetPcId.toLowerCase();
      const match = activePcIds.find(k => k.toLowerCase() === lower);
      if (match) targetPcId = match;
    }

    if (!targetPcId || !registeredPcs[targetPcId]) {
      socket.emit('error', {
        message: `PC / Room not found: ${requestedId || 'none'}`,
        availableRooms: activePcIds
      });
      return;
    }

    const deviceName = (data && (data.mobileName || data.deviceName || data.name || data.model))
      ? String(data.mobileName || data.deviceName || data.name || data.model)
      : (socket.data.deviceName || `Mobile (${socket.id.slice(0, 5)})`);
    const deviceType = (data && (data.deviceType || data.type))
      ? String(data.deviceType || data.type).toLowerCase()
      : 'mobile';

    mobilePcMap[socket.id] = targetPcId;
    connectedMobiles[socket.id] = {
      socket,
      deviceName,
      deviceType,
      pairedPcId: targetPcId,
      ip: clientIp,
      connectedAt: (connectedMobiles[socket.id] && connectedMobiles[socket.id].connectedAt) || new Date().toISOString(),
    };

    socket.data.role = 'mobile';
    socket.data.pairedPcId = targetPcId;
    socket.data.deviceName = deviceName;

    socket.emit('mobile-connected', { pcId: targetPcId, roomId: targetPcId });
    socket.emit('joined', { pcId: targetPcId, roomId: targetPcId });
    
    // Notify PC that a mobile client joined
    try {
      registeredPcs[targetPcId].socket.emit('mobile_joined', { 
        mobileId: socket.id,
        mobileName: deviceName,
        deviceName,
        deviceType,
        roomId: targetPcId
      });
    } catch (_) {}

    console.log(`[MOB] ${socket.id} ("${deviceName}") paired with Room / PC "${targetPcId}"`);
  };

  socket.on('mobile-connect', handleMobileConnect);
  socket.on('connect_pc', handleMobileConnect);
  socket.on('join_room', handleMobileConnect);
  socket.on('register_mobile', handleMobileConnect);
  socket.on('mobile-register', handleMobileConnect);

  // Allow setting or updating device name dynamically
  socket.on('set_device_name', (data) => {
    if (data && (data.name || data.deviceName || data.mobileName)) {
      const newName = String(data.name || data.deviceName || data.mobileName);
      if (socket.data.role === 'pc' && socket.data.pcId && registeredPcs[socket.data.pcId]) {
        registeredPcs[socket.data.pcId].pcName = newName;
      } else if (connectedMobiles[socket.id]) {
        connectedMobiles[socket.id].deviceName = newName;
      }
    }
  });

  // ---- Relay: mobile -> PC (all control events) ----
  const relayToPc = (eventName, rawData) => {
    let data = rawData;
    if (typeof rawData === 'string') {
      try { data = JSON.parse(rawData); } catch (_) {}
    }
    const pcId = mobilePcMap[socket.id];
    if (!pcId || !registeredPcs[pcId]) return;
    try {
      registeredPcs[pcId].socket.emit(eventName, data);
    } catch (err) {
      console.error(`[ERR] Relay error for ${eventName}:`, err.message);
    }
  };

  socket.on('trackpad-move',  (d) => relayToPc('trackpad-move', d));
  socket.on('mouse-click',    (d) => relayToPc('mouse-click',   d));
  socket.on('mouse-scroll',   (d) => relayToPc('mouse-scroll',  d));
  socket.on('volume-change',  (d) => relayToPc('volume-change', d));
  socket.on('control-event',  (d) => relayToPc('control-event', d));
  socket.on('command',        (d) => relayToPc('command',       d));

  // Forward custom direct commands
  socket.on('MOUSE_MOVE',     (d) => relayToPc('trackpad-move', d));
  socket.on('MOUSE_CLICK',    (d) => relayToPc('mouse-click',   d));
  socket.on('MOUSE_SCROLL',   (d) => relayToPc('mouse-scroll',  d));
  socket.on('VOLUME_SET',     (d) => relayToPc('volume-change', d));
  socket.on('SYSTEM_POWER',   (d) => relayToPc('control-event', { action: d?.action, ...d }));
  socket.on('APP_ACTION',     (d) => relayToPc('control-event', d));
  socket.on('APP_LIST',       (d) => relayToPc('control-event', { action: 'get_apps', ...d }));
  socket.on('KEYBOARD_INPUT', (d) => relayToPc('control-event', { action: 'type_text', ...d }));

  // ---- Relay: PC -> mobile (state updates, command results) ----
  socket.on('pc-state', (data) => {
    const pcId = socket.data.pcId;
    if (!pcId) return;
    for (const [mobileId, pid] of Object.entries(mobilePcMap)) {
      if (pid === pcId) {
        io.to(mobileId).emit('pc-state', data);
      }
    }
  });

  socket.on('command_result', (data) => {
    const pcId = socket.data.pcId;
    if (!pcId) return;
    for (const [mobileId, pid] of Object.entries(mobilePcMap)) {
      if (pid === pcId) {
        io.to(mobileId).emit('command_result', data);
      }
    }
  });

  // Keepalive ping / pong
  socket.on('ping', (data) => {
    socket.emit('pong', { time: Date.now() });
  });

  // ---- Disconnection ----
  socket.on('disconnect', (reason) => {
    const role = socket.data.role || 'unknown';
    console.log(`[-] Disconnected: ID=${socket.id} role=${role} (${reason})`);

    if (role === 'pc') {
      const pcId = socket.data.pcId;
      if (pcId) {
        // Notify any paired mobiles that the PC disconnected
        for (const [mobileId, pid] of Object.entries(mobilePcMap)) {
          if (pid === pcId) {
            io.to(mobileId).emit('pc_disconnected', { pcId });
          }
        }
        delete registeredPcs[pcId];
        console.log(`[PC ] Unregistered: ${pcId}`);
      }
    } else if (role === 'mobile') {
      const pcId = mobilePcMap[socket.id];
      if (pcId && registeredPcs[pcId]) {
        try {
          registeredPcs[pcId].socket.emit('mobile_left', { mobileId: socket.id });
        } catch (_) {}
      }
      delete mobilePcMap[socket.id];
      delete connectedMobiles[socket.id];
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