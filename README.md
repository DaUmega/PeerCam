# PeerLive

PeerLive is a **peer-to-peer, encrypted camera web app** that allows users to set up a webcam as a live-streaming camera — now with **real-time chat and customizable display names**. Stream and communicate securely without storing any video or chat data on a server, ensuring privacy and direct peer-to-peer interaction.

---

## Features

- **P2P live streaming**: Connect directly between devices without uploading video to a central server.  
- **Encrypted communication**: Password(hashed)-protected rooms with end-to-end security.  
- **Real-time chat**: Built-in chat system for hosts and viewers to communicate during streams.  
- **Custom display names**: Users can set personalized names in chat rooms for better interaction.  
- **Cross-platform support**: Works on desktop browsers, Android, and iOS (Safari).  
- **Multi-viewer support**: Hosts can stream to multiple viewers simultaneously.  
- **No storage required**: Neither video nor chat data is stored — sessions are temporary and secure.  
- **VPS ready**: Easily self-host on a VPS for global, low-latency access.  

---

## How It Works

1. **Host a room**: Create a room with a unique ID and password.  
2. **Start camera**: Allow access to your webcam and microphone.  
3. **Enable chat** *(optional)*: Open the chat panel for real-time communication with viewers.  
4. **Share URL**: Copy and send the room link to invite others.  
5. **Viewers join**: Other users enter the room ID and password to watch and chat.  
6. **P2P connection**: Both video and chat messages travel directly between peers via WebRTC.  

---

## Installation / Quick Start

```bash
git clone https://github.com/DaUmega/PeerCam.git
cd PeerCam
./setup.sh
