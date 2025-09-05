let socket = null;
let localStream = null;
let peerConnection = null;
let role = null;
let roomId = null;
let password = null;

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
            navigator.clipboard.writeText(url).then(() => {
                alert("Room URL copied to clipboard:\n" + url);
            }).catch(err => {
                alert("Failed to copy URL: " + err);
            });
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
    if (socket && socket.connected) {
        socket.disconnect();
    }
    socket = io();
    setupSocketHandlers();

    socket.on("connect", () => {
        socket.emit("join", { roomId, password });

        // Lock UI after connecting
        createBtn.style.display = "none";
        joinBtn.style.display = "none";
        document.getElementById("roomId").disabled = true;
        document.getElementById("password").disabled = true;
    });
}

function setupConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ],
        sdpSemantics: "unified-plan" // Required for Safari
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("signal", { roomId, data: { candidate: event.candidate } });
        }
    };

    peerConnection.ontrack = (event) => {
		remoteVideo.srcObject = event.streams[0];
		remoteVideo.style.display = "block";
	};

    if (localStream) {
        localStream.getTracks().forEach(track =>
            peerConnection.addTrack(track, localStream)
        );
    }
}

function setupSocketHandlers() {
    socket.on("peer-joined", async (peerId) => {
		statusEl.textContent = `Peer ${peerId} joined.`;
		if (role === "host") {
			setupConnection();
			const offer = await peerConnection.createOffer();
			await peerConnection.setLocalDescription(offer);
			socket.emit("signal", { roomId, data: { sdp: offer }, target: peerId });
		}
	});

    let pendingCandidates = [];

    socket.on("signal", async ({ from, data }) => {
        if (!peerConnection) setupConnection();

        if (data.sdp) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            if (data.sdp.type === "offer") {
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit("signal", { roomId, data: { sdp: answer }, target: from });
            }

            // Add queued candidates
            pendingCandidates.forEach(c => peerConnection.addIceCandidate(new RTCIceCandidate(c)));
            pendingCandidates = [];
        } else if (data.candidate) {
            if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (err) {
                    console.error("Error adding ICE candidate", err);
                }
            } else {
                // Queue until remote description is set
                pendingCandidates.push(data.candidate);
            }
        }
    });

    socket.on("peer-left", (peerId) => {
		statusEl.textContent = `Peer ${peerId} left.`;
		remoteVideo.srcObject = null;
		remoteVideo.style.display = "none";
	});

    socket.on("error", (msg) => {
        statusEl.textContent = "Error: " + msg;
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        // Reset UI
        createBtn.style.display = "block";
        joinBtn.style.display = "block";
        document.getElementById("roomId").disabled = false;
        document.getElementById("password").disabled = false;
        copyUrlBtn.style.display = "none";
        startCameraBtn.style.display = "none";
        localVideo.srcObject = null;
        remoteVideo.srcObject = null;
        localVideo.style.display = "none";
        remoteVideo.style.display = "none";
    });
}

function enableFullscreenOnClick(videoElement) {
    videoElement.addEventListener("click", () => {
        if (videoElement.requestFullscreen) {
            videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) { // Safari
            videoElement.webkitRequestFullscreen();
        } else if (videoElement.msRequestFullscreen) { // IE/Edge
            videoElement.msRequestFullscreen();
        }
    });
}

// Enable fullscreen toggle
enableFullscreenOnClick(localVideo);
enableFullscreenOnClick(remoteVideo);

// Auto-fill room ID if ?room= param exists in URL
window.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const prefillRoom = params.get("room");
    if (prefillRoom) {
        document.getElementById("roomId").value = prefillRoom;
    }
});
