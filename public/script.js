let socket = null;
let localStream = null;
let peerConnection = null;
let role = null;
let roomId = null;
let password = null;

let reconnectInterval = null;
let reconnectAttempts = 0;
let authFailed = false;

const peerConnections = {}; // peerId -> RTCPeerConnection
const pendingCandidates = {}; // peerId -> ICE candidate queue

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const startCameraBtn = document.getElementById("startCameraBtn");
const copyUrlBtn = document.getElementById("copyUrlBtn");
const statusEl = document.getElementById("status");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

createBtn.onclick = async () => {
    roomId = document.getElementById("roomId").value.trim();
    password = document.getElementById("password").value;

    if (!roomId || !password) {
        alert("Room ID and password are required");
        return;
    }

    role = "host";
    try {
        const res = await fetch(`/create/${roomId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });

        // robust parsing: server may return JSON or plain text (rate limiter)
        let body;
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
            body = await res.json();
        } else {
            const text = await res.text();
            try {
                // try parse JSON again just in case
                body = JSON.parse(text);
            } catch {
                body = { error: text };
            }
        }

        if (!res.ok) {
            alert("Room creation failed: " + (body?.error || `HTTP ${res.status}`));
            return;
        }

        startCameraBtn.style.display = "block";
        copyUrlBtn.style.display = "block";
        statusEl.textContent = `Room ${roomId} created. Start camera to begin streaming.`;

        copyUrlBtn.onclick = () => {
            const url = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
            navigator.clipboard.writeText(url)
                .then(() => alert("Room URL copied to clipboard:\n" + url))
                .catch(err => alert("Failed to copy URL: " + err));
        };
    } catch (err) {
        alert("Failed to create room: " + err.message);
    }
};

joinBtn.onclick = () => {
	roomId = document.getElementById("roomId").value.trim();
	password = document.getElementById("password").value;

	if (!roomId || !password) {
		alert("Room ID and password are required");
		return;
	}

	role = "viewer";
	authFailed = false; // reset before connecting
	connectToRoom(roomId, password);
};

startCameraBtn.onclick = async () => {
	await startCamera();
	connectToRoom(roomId, password);
};

async function startCamera() {
	try {
		localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
		localVideo.srcObject = localStream;
		localVideo.style.display = "block";
		startCameraBtn.style.display = "none";
	} catch (err) {
		alert("Failed to access camera: " + err.message);
	}
}

function connectToRoom(roomId, password) {
    // always tear down any previous socket/handlers before creating a new connection
    if (socket) {
        try {
            socket.removeAllListeners();
            socket.disconnect();
        } catch (e) {
            console.warn("Error while disconnecting previous socket:", e);
        }
        socket = null;
    }

    // force a fresh connection to avoid reuse of stale sid after network/VPN changes
    socket = io({ forceNew: true, transports: ["polling", "websocket"] });
    setupSocketHandlers();

    socket.on("connect_error", (err) => {
        console.warn("Socket connect_error:", err);
        statusEl.textContent = "Connection error: " + (err && err.message ? err.message : err);
    });

    socket.on("connect", () => {
        // use ack from server to decide when to update UI and clear previous errors
        socket.emit("join", { roomId, password }, (res) => {
            if (res && res.ok) {
                // success: update UI and clear stale status
                createBtn.style.display = "none";
                joinBtn.style.display = "none";
                document.getElementById("roomId").disabled = true;
                document.getElementById("password").disabled = true;
                statusEl.textContent = "";
                authFailed = false;
            } else {
                // failed: show server message (could be rate-limit or invalid password)
                statusEl.textContent = "Error: " + (res?.error || "Join failed");
                authFailed = true;
                // disconnect socket to keep UI consistent
                if (socket) {
                    socket.removeAllListeners();
                    socket.disconnect();
                    socket = null;
                }
            }
        });
    });
}

function setupConnection() {
	const pc = new RTCPeerConnection({
		iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
		sdpSemantics: "unified-plan"
	});

	pc.onicecandidate = (event) => {
		if (event.candidate) {
			socket.emit("signal", {
				roomId,
				data: { candidate: event.candidate },
				target: Object.keys(peerConnections).find(k => peerConnections[k] === pc)
			});
		}
	};

	pc.ontrack = (event) => {
		remoteVideo.srcObject = event.streams[0];
		remoteVideo.style.display = "block";
	};

	if (localStream) {
		localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
	}

	// 🧠 Advanced connection monitoring
	pc.onconnectionstatechange = () => {
		const state = pc.connectionState;
		console.log("Peer connection state:", state);
		if (state === "disconnected" || state === "failed" || state === "closed") {
			statusEl.textContent = "Connection lost. Attempting to reconnect...";
			if (role === "viewer" && !authFailed) {
				handleHostDisconnected();
			}
		}
	};

	return pc;
}

function setupSocketHandlers() {
    // optional: support server-side 'server-error' for clarity
    socket.on("server-error", (msg) => {
        console.warn("Server error:", msg);
        statusEl.textContent = "Error: " + msg;
        if (typeof msg === "string" && (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("password"))) {
            authFailed = true;
        }
        // ensure UI is reset
        cleanupAndResetUI();
    });

    // existing error listener left for compatibility
    socket.on("error", (msg) => {
        // some socket.io internal errors may arrive here; show them
        console.warn("Socket error:", msg);
        if (typeof msg === "string") {
            statusEl.textContent = "Error: " + msg;
            if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("password")) {
                authFailed = true;
            }
        }
        // cleanup and reset
        cleanupAndResetUI();
    });

	socket.on("peer-joined", async (peerId) => {
		statusEl.textContent = `Peer ${peerId} joined.`;

		if (role === "host") {
			const pc = setupConnection();
			peerConnections[peerId] = pc;
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			socket.emit("signal", { roomId, data: { sdp: offer }, target: peerId });
		}
	});

	socket.on("signal", async ({ from, data }) => {
		let pc = peerConnections[from];
		if (!pc) {
			pc = setupConnection();
			peerConnections[from] = pc;
		}

		if (data.sdp) {
			await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
			if (data.sdp.type === "offer") {
				const answer = await pc.createAnswer();
				await pc.setLocalDescription(answer);
				socket.emit("signal", { roomId, data: { sdp: answer }, target: from });
			}

			pendingCandidates[from]?.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)));
			pendingCandidates[from] = [];
		} else if (data.candidate) {
			if (pc.remoteDescription && pc.remoteDescription.type) {
				await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
			} else {
				pendingCandidates[from] = pendingCandidates[from] || [];
				pendingCandidates[from].push(data.candidate);
			}
		}
	});

	socket.on("peer-left", (peerId) => {
		statusEl.textContent = `Peer ${peerId} left.`;
		if (peerConnections[peerId]) {
			peerConnections[peerId].close();
			delete peerConnections[peerId];
		}
	});
}

function handleHostDisconnected() {
    if (reconnectInterval || authFailed) return; // don't loop twice or retry if auth failed
    reconnectAttempts = 0;
    statusEl.textContent = "Host disconnected. Waiting to reconnect...";

    reconnectInterval = setInterval(() => {
        if (authFailed) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
            return;
        }
        if (reconnectAttempts >= 12) { // 2 minutes total (10s interval)
            clearInterval(reconnectInterval);
            reconnectInterval = null;
            statusEl.textContent = "Host did not reconnect within 2 minutes.";
            return;
        }
        reconnectAttempts++;
        console.log(`Reconnect attempt ${reconnectAttempts}`);

        // create a fresh socket and attempt to join again (old socket may be dead / have stale sid)
        try {
            connectToRoom(roomId, password);
        } catch (e) {
            console.warn("Reconnect attempt failed to start:", e);
        }
    }, 10000);
}

function cleanupAndResetUI() {
	if (reconnectInterval) {
		clearInterval(reconnectInterval);
		reconnectInterval = null;
	}
	if (socket) {
		socket.disconnect();
		socket = null;
	}
	Object.values(peerConnections).forEach(pc => pc.close());
	for (const k in peerConnections) delete peerConnections[k];
	localVideo.srcObject = null;
	remoteVideo.srcObject = null;
	localVideo.style.display = "none";
	remoteVideo.style.display = "none";
	startCameraBtn.style.display = "none";
	copyUrlBtn.style.display = "none";
	createBtn.style.display = "block";
	joinBtn.style.display = "block";
	document.getElementById("roomId").disabled = false;
	document.getElementById("password").disabled = false;
}

function enableFullscreenOnClick(videoElement) {
	videoElement.addEventListener("click", () => {
		if (videoElement.requestFullscreen) videoElement.requestFullscreen();
		else if (videoElement.webkitRequestFullscreen) videoElement.webkitRequestFullscreen();
		else if (videoElement.msRequestFullscreen) videoElement.msRequestFullscreen();
	});
}

enableFullscreenOnClick(localVideo);
enableFullscreenOnClick(remoteVideo);

window.addEventListener("DOMContentLoaded", () => {
	const params = new URLSearchParams(window.location.search);
	const prefillRoom = params.get("room");
	if (prefillRoom) document.getElementById("roomId").value = prefillRoom;
});
