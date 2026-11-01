# Remote Control Backend & Relay Server

A lightweight Node.js & Socket.IO server designed to monitor system health and relay trackpad, mouse, volume, and control events between Flutter mobile devices and PC applications.

---

## 📊 Complete Flow Diagrams

### 1. End-to-End System & Architecture Flow

```mermaid
flowchart TD
    Start(["Start System"]) --> CheckNet{"Are Mobile & PC on the same Wi-Fi / LAN?"}

    %% LAN Direct Path
    CheckNet -- Yes --> DirectLAN["Primary Path: Direct LAN Connection"]
    DirectLAN --> DirectWS["Connect directly via ws://PC_LAN_IP:8080"]
    DirectWS --> DirectControl["Direct Low-Latency Control"]

    %% Remote Relay Path
    CheckNet -- No --> StartRelay["Secondary Path: Node.js Relay Server (:3000)"]
    StartRelay --> PCReg["1. PC connects & registers: pc-register (pcId)"]
    PCReg --> ServerStore["Server registers PC in registeredPcs map"]
    ServerStore --> MobilePair["2. Mobile connects & requests: mobile-connect (pcId)"]
    
    MobilePair --> VerifyPair{"Does pcId exist in server?"}
    VerifyPair -- No --> ErrorMsg["Emit error: PC not found"]
    VerifyPair -- Yes --> PairSuccess["Pairing Confirmed: mobile-connected"]

    %% Event Transmission
    PairSuccess --> ControlLoop["3. Mobile sends touch / key inputs"]
    ControlLoop --> EventType{"Event Type"}
    
    EventType -->|"trackpad-move"| R1["Relay Pointer Position (dx, dy)"]
    EventType -->|"mouse-click"| R2["Relay Click (Left / Right / Middle)"]
    EventType -->|"mouse-scroll"| R3["Relay Scroll Wheel (dx, dy)"]
    EventType -->|"volume-change"| R4["Relay Volume Level"]
    EventType -->|"control-event"| R5["Relay Hotkey / Media Action"]

    R1 & R2 & R3 & R4 & R5 --> ExecutePC["PC receives & executes action via OS API"]
    ExecutePC --> PCFeedback["PC emits pc-state (status updates)"]
    PCFeedback --> RelayBack["Relay server forwards pc-state back to paired Mobile"]
```

---

### 2. Device Registration & Relay Sequence

```mermaid
sequenceDiagram
    autonumber
    participant PC as PC Companion / C++ App
    participant Server as Node.js Relay Server (:3000)
    participant Mobile as Flutter Mobile App

    Note over PC,Server: 1. PC Registration
    PC->>Server: emit("pc-register", { pcId: "my-pc-1" })
    Server-->>PC: emit("pc-registered", { pcId: "my-pc-1" })

    Note over Mobile,Server: 2. Mobile Pairing
    Mobile->>Server: emit("mobile-connect", { pcId: "my-pc-1" })
    Server-->>Mobile: emit("mobile-connected", { pcId: "my-pc-1" })

    Note over Mobile,PC: 3. Control Events Relay
    Mobile->>Server: emit("trackpad-move" / "mouse-click" / "volume-change", payload)
    Server->>PC: relay event to registered PC socket

    Note over PC,Mobile: 4. PC State Feedback
    PC->>Server: emit("pc-state", stateData)
    Server->>Mobile: emit("pc-state", stateData)
```

---

### 3. Server Status & Health Check UI Flow

```mermaid
flowchart LR
    User["User opens Browser at http://localhost:3000"] --> FetchHTML["GET /: Express serves Status Dashboard"]
    FetchHTML --> UI["Render Dashboard UI"]
    
    subgraph PollingLoop["Real-Time Monitor (Every 3s)"]
        UI --> Ping["Fetch /health with cache: no-store"]
        Ping --> Check{"HTTP Status?"}
        Check -- 200 OK --> Healthy["🟢 Status: ONLINE<br/>Latency: ~2ms<br/>Uptime & Connected PCs updated"]
        Check -- Failed / No Response --> Unhealthy["🔴 Status: OFFLINE<br/>Server Not Responding Banner"]
    end

    Healthy --> UI
    Unhealthy --> UI
```

---

## 📋 System Stages Summary

| Stage | Action | Protocol / Port |
| :--- | :--- | :--- |
| **Status Check** | Open browser to check if server is active | HTTP `GET /` on port `3000` |
| **PC Registration** | PC tells server it is ready for remote commands | Socket.IO `pc-register` |
| **Mobile Pairing** | Mobile app links to a specific PC ID | Socket.IO `mobile-connect` |
| **Control Events** | Mouse movements, clicks, and volume commands | Socket.IO events forwarded from Mobile $\to$ Server $\to$ PC |

---

## 🚀 How to Run

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   *Or for auto-reload during development:*
   ```bash
   npm run dev
   ```

---

## 🌐 Endpoints & UI

| URL | Type | Description |
| :--- | :--- | :--- |
| **`http://localhost:3000/`** | Web Dashboard | Visual real-time dashboard showing server status (Online 🟢 / Offline 🔴), port, uptime, and connected devices with laptop/mobile icons. |
| **`http://localhost:3000/health`** | REST API | Returns JSON payload with `{ status, uptimeSeconds, registeredPcs, connectedMobiles, totalDevices, port, devices }`. |
| **`http://localhost:3000/api/devices`** | REST API | Returns connected devices with names, types (`laptop` / `mobile`), IPs, and paired hosts. |
| **`ws://localhost:3000/socket.io/`** | WebSocket | Socket.IO endpoint used for PC registration and mobile remote control relay. |

---

## 📡 Socket.IO Event Reference

### Mobile -> Server
- `mobile-connect`: `{ pcId, deviceName?, deviceType? }` - Pair mobile client with a registered PC (e.g. `{ pcId: "pc-1", deviceName: "Pixel 8", deviceType: "mobile" }`)
- `trackpad-move`: `{ dx, dy }` - Relative trackpad pointer movement
- `mouse-click`: `{ button: "left" | "right" | "middle" }` - Mouse click event
- `mouse-scroll`: `{ dx, dy }` - Scroll wheel motion
- `volume-change`: `{ level }` - System volume control
- `control-event`: `{ key, action }` - Custom media / hotkey trigger

### PC -> Server
- `pc-register`: `{ pcId, pcName?, deviceType? }` - Register PC as available for remote pairing (e.g. `{ pcId: "pc-1", pcName: "Gaming Laptop", deviceType: "laptop" }`)
- `pc-state`: `{ ... }` - Broadcast PC status updates to paired mobile clients
