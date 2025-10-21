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
const displayNameInput = document.getElementById("displayName");
const chatPanel = document.getElementById("chatPanel");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatToggle = document.getElementById("chatToggle");
const chatFullscreenBtn = document.getElementById("chatFullscreenBtn");

const localWrapper = document.getElementById("localWrapper");
const remoteWrapper = document.getElementById("remoteWrapper");

const MAX_CHAT_LENGTH = 500;

if (chatPanel) {
    chatPanel.style.display = "none";
}
if (chatInput) {
    chatInput.disabled = true;
}
if (chatSendBtn) {
    chatSendBtn.disabled = true;
}

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

        let body;
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
            body = await res.json();
        } else {
            const text = await res.text();
            try {
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
    authFailed = false;
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
        if (localWrapper && localWrapper.classList.contains("hidden")) {
            localWrapper.classList.remove("hidden");
        }
        startCameraBtn.style.display = "none";
    } catch (err) {
        alert("Failed to access camera: " + err.message);
    }
}

function connectToRoom(roomId, password) {
    if (socket) {
        try {
            socket.removeAllListeners();
            socket.disconnect();
        } catch (e) {
            console.warn("Error while disconnecting previous socket:", e);
        }
        socket = null;
    }

    socket = io({ forceNew: true, transports: ["polling", "websocket"] });
    setupSocketHandlers();

    socket.on("connect_error", (err) => {
        console.warn("Socket connect_error:", err);
        statusEl.textContent = "Connection error: " + (err && err.message ? err.message : err);
    });

    socket.on("connect", () => {
        const displayName = (displayNameInput && displayNameInput.value) ? displayNameInput.value.trim() : "";

        socket.emit("join", { roomId, password, displayName }, (res) => {
            if (res && res.ok) {
                createBtn.style.display = "none";
                joinBtn.style.display = "none";
                document.getElementById("roomId").disabled = true;
                document.getElementById("password").disabled = true;
                if (displayNameInput) displayNameInput.disabled = true;
                statusEl.textContent = "";
                authFailed = false;

                if (chatPanel) chatPanel.style.display = "";
                if (chatInput) chatInput.disabled = false;
                if (chatSendBtn) chatSendBtn.disabled = false;
            } else {
                statusEl.textContent = "Error: " + (res?.error || "Join failed");
                authFailed = true;
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
        if (remoteWrapper && remoteWrapper.classList.contains("hidden")) {
            remoteWrapper.classList.remove("hidden");
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

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
    socket.on("server-error", (msg) => {
        console.warn("Server error:", msg);
        statusEl.textContent = "Error: " + msg;
        if (typeof msg === "string" && (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("password"))) {
            authFailed = true;
        }
        cleanupAndResetUI();
    });

    socket.on("error", (msg) => {
        console.warn("Socket error:", msg);
        if (typeof msg === "string") {
            statusEl.textContent = "Error: " + msg;
            if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("password")) {
                authFailed = true;
            }
        }
        cleanupAndResetUI();
    });

    socket.on("chat", (payload) => {
        appendChatMessage(payload);
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
    if (reconnectInterval || authFailed) return;
    reconnectAttempts = 0;
    statusEl.textContent = "Host disconnected. Waiting to reconnect...";

    reconnectInterval = setInterval(() => {
        if (authFailed) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
            return;
        }
        if (reconnectAttempts >= 12) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
            statusEl.textContent = "Host did not reconnect within 2 minutes.";
            return;
        }
        reconnectAttempts++;
        console.log(`Reconnect attempt ${reconnectAttempts}`);

        try {
            connectToRoom(roomId, password);
        } catch (e) {
            console.warn("Reconnect attempt failed to start:", e);
        }
    }, 10000);
}

function decodeHtmlEntities(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.innerHTML = str;
    return div.textContent;
}

function appendChatMessage({ from, name, message, time } = {}) {
    if (!chatMessages) return;
    const item = document.createElement("div");
    item.className = "chat-message";

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    const t = time ? new Date(time) : new Date();
    const ts = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const who = (name && name.length) ? decodeHtmlEntities(name) : (from ? from.slice(0, 8) : "unknown");
    meta.textContent = `${ts} • ${who}`;

    const text = document.createElement("div");
    const decoded = decodeHtmlEntities(message || "");
    text.textContent = decoded;

    item.appendChild(meta);
    item.appendChild(text);
    chatMessages.appendChild(item);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
    if (!socket || socket.disconnected) return;
    const raw = (chatInput.value || "").trim();
    if (!raw) return;
    const msg = raw.slice(0, MAX_CHAT_LENGTH);
    socket.emit("chat", { roomId, message: msg }, (res) => {
        if (res && res.ok) {
            chatInput.value = "";
        } else {
            const err = res?.error || "Failed to send";
            appendChatMessage({ name: "System", message: err, time: Date.now() });
        }
    });
}

if (chatSendBtn) {
    chatSendBtn.addEventListener("click", sendChatMessage);
}

if (chatInput) {
    chatInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            sendChatMessage();
        }
    });
}

if (chatToggle) {
    chatToggle.addEventListener("click", () => {
        if (!chatPanel) return;
        chatPanel.classList.toggle("collapsed");
        chatToggle.textContent = chatPanel.classList.contains("collapsed") ? "+" : "─";
    });
}

if (chatFullscreenBtn) {
    chatFullscreenBtn.addEventListener("click", async () => {
        if (!chatPanel) return;

        // detect whether chatPanel is currently fullscreen (standard + vendor prefixes)
        const isStdFullscreen = document.fullscreenElement === chatPanel;
        const isWebkitFullscreen = document.webkitFullscreenElement === chatPanel;
        const isMsFullscreen = document.msFullscreenElement === chatPanel;
        const isCurrentlyFullscreen = !!(isStdFullscreen || isWebkitFullscreen || isMsFullscreen);

        // If Fullscreen API is available prefer it so user can press ESC to exit.
        const supportsFullscreen = !!(chatPanel.requestFullscreen || chatPanel.webkitRequestFullscreen || chatPanel.msRequestFullscreen);

        try {
            if (supportsFullscreen) {
                if (isCurrentlyFullscreen) {
                    if (document.exitFullscreen) await document.exitFullscreen();
                    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
                    else if (document.msExitFullscreen) await document.msExitFullscreen();
                    document.body.classList.remove("chat-fullscreen-active");
                } else {
                    if (chatPanel.requestFullscreen) await chatPanel.requestFullscreen();
                    else if (chatPanel.webkitRequestFullscreen) await chatPanel.webkitRequestFullscreen();
                    else if (chatPanel.msRequestFullscreen) await chatPanel.msRequestFullscreen();
                    // when chat is fullscreen hide other UI (video/controls)
                    document.body.classList.add("chat-fullscreen-active");
                }
            } else {
                // fallback: toggle CSS fullscreen class + hide other UI
                const now = chatPanel.classList.toggle("fullscreen");
                document.body.classList.toggle("chat-fullscreen-active", now);
            }
        } catch (err) {
            console.warn("Fullscreen toggle failed:", err);
        }
    });

    // Keep body class in sync if user exits fullscreen via ESC or other UI.
    const onFsChange = () => {
        const isStd = document.fullscreenElement === chatPanel;
        const isWebkit = document.webkitFullscreenElement === chatPanel;
        const isMs = document.msFullscreenElement === chatPanel;
        const active = !!(isStd || isWebkit || isMs);
        document.body.classList.toggle("chat-fullscreen-active", active);
        // if not active, also remove fallback class
        if (!active && chatPanel.classList.contains("fullscreen")) {
            chatPanel.classList.remove("fullscreen");
        }
    };

    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    document.addEventListener("msfullscreenchange", onFsChange);
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

    if (localVideo) {
        localVideo.srcObject = null;
        localVideo.style.display = "none";
        if (localWrapper && !localWrapper.classList.contains("hidden")) {
            localWrapper.classList.add("hidden");
        }
    }
    if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = "none";
        if (remoteWrapper && !remoteWrapper.classList.contains("hidden")) {
            remoteWrapper.classList.add("hidden");
        }
    }

    startCameraBtn.style.display = "none";
    copyUrlBtn.style.display = "none";
    createBtn.style.display = "block";
    joinBtn.style.display = "block";
    document.getElementById("roomId").disabled = false;
    document.getElementById("password").disabled = false;
    if (displayNameInput) displayNameInput.disabled = false;

    if (chatMessages) chatMessages.innerHTML = "";
    if (chatInput) {
        chatInput.value = "";
        chatInput.disabled = true;
    }
    if (chatSendBtn) chatSendBtn.disabled = true;
    if (chatPanel) {
        chatPanel.classList.remove("collapsed");
        chatPanel.style.display = "none";
    }
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

    if (localWrapper && !localWrapper.classList.contains("hidden")) localWrapper.classList.add("hidden");
    if (remoteWrapper && !remoteWrapper.classList.contains("hidden")) remoteWrapper.classList.add("hidden");
});
