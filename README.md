# Remote Control Backend Server

A Node.js & WebSocket relay server bridging trackpad, volume, and control events between mobile devices and PC applications.

## How to Run

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   Or run in development mode with auto-reload:
   ```bash
   npm run dev
   ```

## Server Status & UI

Once started, open your browser to verify the server status:

- **Dashboard UI:** [http://localhost:3000](http://localhost:3000)  
  *Provides a real-time status page showing whether the server is running, uptime, port, and connected devices.*
- **Health Check Endpoint:** [http://localhost:3000/health](http://localhost:3000/health)  
  *Returns JSON status with uptime and device count.*
