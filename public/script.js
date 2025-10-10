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
		if (!res.ok) {
			const err = await res.json();
			alert("Room creation failed: " + err.error);
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
	if (socket && socket.connected) socket.disconnect();
	socket = io();
	setupSocketHandlers();

	socket.on("connect", () => {
        socket.emit("join", { roomId, password });
        createBtn.style.display = "none";
        joinBtn.style.display = "none";
        document.getElementById("roomId").disabled = true;
        document.getElementById("password").disabled = true;
        statusEl.textContent = "";
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

	socket.on("error", (msg) => {
		console.warn("Server error:", msg);
		statusEl.textContent = "Error: " + msg;

		// Detect password issue
		if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("password")) {
			authFailed = true; // 🚨 stop reconnect attempts
		}

		cleanupAndResetUI();
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
		socket.emit("join", { roomId, password });
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
