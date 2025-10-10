// npm install express socket.io bcrypt express-rate-limit
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// In-memory store for rooms
const rooms = {};
const ROOM_TTL = 1000 * 60 * 30; // 30 min auto cleanup
const MAX_CONNECTIONS_PER_IP = 5; // Prevent DDoS: max clients per IP per room
const SALT_ROUNDS = 10; // bcrypt cost factor

// Global rate limiter: max 20 requests per IP per minute
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    handler: (req, res) => {
        const msg = "Too many requests from this IP, try again later.";
        if (req.accepts && req.accepts("json")) return res.status(429).json({ error: msg });
        return res.status(429).type("text").send(msg);
    }
});
app.use(globalLimiter);

// Specific limiter for creating rooms: max 1 per IP per minute
const createLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1,
    handler: (req, res) => {
        const msg = "Too many create requests from this IP, try again later.";
        if (req.accepts && req.accepts("json")) return res.status(429).json({ error: msg });
        return res.status(429).type("text").send(msg);
    }
});

// Middleware for JSON parsing
app.use(express.json());

// Serve static files (index.html, etc.)
app.use(express.static("public"));

// Endpoint for creating a room
app.post("/create/:roomId", createLimiter, async (req, res) => {
    const { roomId } = req.params;
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: "Password required" });
    }
    if (rooms[roomId]) {
        // allow recreation if the room exists but has no active socket connections
        const existing = rooms[roomId];

        // check whether any of the recorded client socket ids are still connected
        const hasActive = Array.from(existing.clients.keys()).some(socketId => {
            // io.sockets.sockets is a Map in Socket.IO v3/v4
            return Boolean(io.sockets.sockets.get && io.sockets.sockets.get(socketId));
        });

        if (existing.clients && existing.clients.size === 0 || !hasActive) {
            // stale / empty room: remove it and allow new creation
            clearTimeout(existing.timeout);
            delete rooms[roomId];
            // fall through to create new room
        } else {
            return res.status(400).json({ error: "Room already exists" });
        }
    }

    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        rooms[roomId] = {
            passwordHash,
            clients: new Map(), // socketId -> IP
            createdAt: Date.now(),
            timeout: setTimeout(() => {
                cleanupRoom(roomId);
            }, ROOM_TTL)
        };
        return res.json({ success: true, roomId });
    } catch (err) {
        console.error("Hashing failed:", err);
        return res.status(500).json({ error: "Internal error" });
    }
});

// Cleanup helper
function cleanupRoom(roomId) {
	if (rooms[roomId]) {
		clearTimeout(rooms[roomId].timeout);
		delete rooms[roomId];
		console.log(`Room ${roomId} cleaned up`);
	}
}

// Socket.IO handling
io.on("connection", (socket) => {
    const ip = socket.handshake.address;
    console.log(`New client connected from ${ip}`);

    socket.on("join", async ({ roomId, password } = {}, callback) => {
        // support optional callback ack
        const ack = typeof callback === "function" ? callback : null;

        const room = rooms[roomId];
        if (!room) {
            const errMsg = "Invalid room/password";
            if (ack) ack({ ok: false, error: errMsg });
            socket.emit("server-error", errMsg);
            return;
        }

        // Prevent duplicate joins
        if (room.clients.has(socket.id)) {
            const warn = "Already joined this room";
            if (ack) ack({ ok: false, error: warn });
            socket.emit("warning", warn);
            return;
        }

        try {
            const valid = await bcrypt.compare(password, room.passwordHash);
            if (!valid) {
                const errMsg = "Invalid room/password";
                if (ack) ack({ ok: false, error: errMsg });
                socket.emit("server-error", errMsg);
                // disconnect after sending ack/event
                socket.disconnect(true);
                return;
            }
        } catch (err) {
            console.error("Password check failed:", err);
            const errMsg = "Internal error";
            if (ack) ack({ ok: false, error: errMsg });
            socket.emit("server-error", errMsg);
            socket.disconnect(true);
            return;
        }

        // Enforce per-IP connection limit
        const ipCount = Array.from(room.clients.values())
            .filter(addr => addr === ip).length;

        if (ipCount >= MAX_CONNECTIONS_PER_IP) {
            const errMsg = "Too many connections from your IP in this room";
            if (ack) ack({ ok: false, error: errMsg });
            socket.emit("server-error", errMsg);
            socket.disconnect(true);
            return;
        }

        // Register client
        room.clients.set(socket.id, ip);
        socket.join(roomId);
        socket.to(roomId).emit("peer-joined", socket.id);

        // Refresh cleanup timer
        clearTimeout(room.timeout);
        room.timeout = setTimeout(() => {
            cleanupRoom(roomId);
        }, ROOM_TTL);

        if (ack) ack({ ok: true, roomId });
    });

    socket.on("signal", ({ roomId, data, target }) => {
		const room = rooms[roomId];
		if (!room || !room.clients.has(socket.id)) return; // not in room

		if (target && room.clients.has(target)) {
			io.to(target).emit("signal", { from: socket.id, data });
		} else {
			socket.to(roomId).emit("signal", { from: socket.id, data });
		}
	});

    socket.on("disconnect", () => {
		console.log(`Client from ${ip} disconnected`);
		for (const roomId in rooms) {
			if (rooms[roomId].clients.has(socket.id)) {
				rooms[roomId].clients.delete(socket.id);
				socket.to(roomId).emit("peer-left", socket.id);
				if (rooms[roomId].clients.size === 0) {
					setTimeout(() => {
						if (rooms[roomId] && rooms[roomId].clients.size === 0) {
							cleanupRoom(roomId);
						}
					}, 2 * 60 * 1000); // 2-minutes grace period for reconnect
				}
			}
		}
	});
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});
