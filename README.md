# PeerCam

PeerCam is a **peer-to-peer, encrypted camera web app** that allows users to set up a webcam as a live-streaming security camera. Stream securely to other users without storing video on a server, ensuring privacy and real-time access.

---

## Features

- **P2P live streaming**: Connect directly between devices without uploading video to a central server.  
- **Encrypted communication**: Password(hashed)-protected rooms with end-to-end security.  
- **Cross-platform support**: Works on desktop browsers, Android, and iOS (Safari).  
- **Multi-viewer support**: Hosts can stream to multiple viewers simultaneously.  
- **No storage required**: Streams are temporary and can run indefinitely without saving to disk.  
- **VPS ready**: Can be easily self hosted on a VPS for global access.

---

## How It Works

1. **Host a room**: Create a room with a unique ID and password.  
2. **Start camera**: Allow access to your webcam/microphone.  
3. **Share URL**: Copy the room URL to invite viewers.  
4. **Viewers join**: Other users enter the room ID and password to watch the live stream.  
5. **P2P connection**: Video streams directly between host and viewers using WebRTC.  

---

## Installation / Quick Start

```bash
git clone https://github.com/DaUmega/PeerCam.git
cd PeerCam
./setup.sh
```

---

## Security & Privacy
- All streams are peer-to-peer; no video is stored on the server by default.
- Rooms are password-protected with hashed passwords.
- Only users with the correct room ID and password can connect.

---

## Notes About Firewalls & TURN Servers
- Peer-to-peer streaming uses WebRTC, which typically connects directly via STUN servers.
- On strict networks (corporate firewalls, NAT, or VPNs), direct P2P may fail.
- Using a TURN server allows relaying traffic over TCP/443, which works behind strict firewalls.
- Currently, PeerCam works best on home networks, mobile devices, and open networks. For maximum reliability on restricted networks, setting up a TURN server is recommended.

---

## Contributing
- Contributions are welcome! Please open an issue or submit a pull request with improvements.