import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import xss from 'xss';

dotenv.config();

const MASTER_PASSWORD = process.env.MASTER_PASSWORD;
if (!MASTER_PASSWORD) {
  console.error('MASTER_PASSWORD missing in .env');
  process.exit(1);
}

const PORT = 3000;
const wss = new WebSocketServer({ port: PORT });

const rooms = {}; // { roomId: { passwordHash, clients: Set<WebSocket> } }

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return ws.send(JSON.stringify({ error: 'Invalid JSON' }));
    }

    const type = xss(data.type);
    const roomId = xss(data.roomId || '');
    const password = xss(data.password || '');
    const role = xss(data.role || '');

    // Sanitize all room IDs and passwords
    if (!roomId.match(/^[a-zA-Z0-9_-]{3,32}$/)) {
      return ws.send(JSON.stringify({ error: 'Invalid room ID format' }));
    }

    if (type === 'create') {
      if (data.masterPassword !== MASTER_PASSWORD) {
        return ws.send(JSON.stringify({ error: 'Invalid master password' }));
      }

      const hash = await bcrypt.hash(password, 10);
      rooms[roomId] = { passwordHash: hash, clients: new Set() };
      rooms[roomId].clients.add(ws);
      ws.roomId = roomId;
      return ws.send(JSON.stringify({ success: 'Room created' }));
    }

    if (type === 'join') {
      const room = rooms[roomId];
      if (!room) return ws.send(JSON.stringify({ error: 'Room not found' }));

      const match = await bcrypt.compare(password, room.passwordHash);
      if (!match) return ws.send(JSON.stringify({ error: 'Wrong password' }));

      room.clients.add(ws);
      ws.roomId = roomId;

      // Inform existing clients
      for (const client of room.clients) {
        if (client !== ws && client.readyState === ws.OPEN) {
          client.send(JSON.stringify({ type: 'new-peer' }));
        }
      }

      return ws.send(JSON.stringify({ success: 'Joined room' }));
    }

    if (type === 'signal') {
      const room = rooms[ws.roomId];
      if (!room) return;

      for (const client of room.clients) {
        if (client !== ws && client.readyState === ws.OPEN) {
          client.send(JSON.stringify({
            type: 'signal',
            signal: data.signal
          }));
        }
      }
    }
  });

  ws.on('close', () => {
    const roomId = ws.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].clients.delete(ws);
      if (rooms[roomId].clients.size === 0) {
        delete rooms[roomId]; // Cleanup empty rooms
      }
    }
  });
});

console.log(`Signaling server running on ws://localhost:${PORT}`);
