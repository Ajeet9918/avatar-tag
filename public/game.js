let myId = null;
let myColor = '#4af';
let taggerId = null;
let roundActive = true;
let winnerId = null;

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const joystickZone = document.getElementById('joystick-zone');
const joystickStick = document.getElementById('joystick-stick');

if (isTouchDevice) joystickZone.style.display = 'block';

// --- Joystick logic ---
let joystickVector = { x: 0, y: 0 };
let joystickActive = false;
let joystickTouchId = null;
const JOYSTICK_RADIUS = 90;

function updateStickVisual(dx, dy) {
    joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
}

function handleJoystickMove(clientX, clientY) {
    const rect = joystickZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > JOYSTICK_RADIUS) {
        dx = (dx / dist) * JOYSTICK_RADIUS;
        dy = (dy / dist) * JOYSTICK_RADIUS;
    }

    updateStickVisual(dx, dy);
    joystickVector.x = dx / JOYSTICK_RADIUS;
    joystickVector.y = dy / JOYSTICK_RADIUS;
}

function resetJoystick() {
    joystickActive = false;
    joystickTouchId = null;
    joystickVector.x = 0;
    joystickVector.y = 0;
    updateStickVisual(0, 0);
}

joystickZone.addEventListener('touchstart', (e) => {
    const touch = e.changedTouches[0];
    joystickActive = true;
    joystickTouchId = touch.identifier;
    handleJoystickMove(touch.clientX, touch.clientY);
});

joystickZone.addEventListener('touchmove', (e) => {
    for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) {
            handleJoystickMove(touch.clientX, touch.clientY);
        }
    }
});

window.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) resetJoystick();
    }
});
// --- End joystick logic ---

const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${wsProtocol}://${location.host}`);

socket.onopen = () => console.log('Connected to server');
socket.onclose = () => console.log('Disconnected from server');

const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

const player = { x: 400, y: 300, speed: 200 };
const otherPlayers = {}; // id -> { buffer, renderX, renderY, color }

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
let accumulator = 0;
let lastTime = performance.now();

const INTERP_DELAY = 100;
let inputSeq = 0;
const pendingInputs = [];

function interpolateOthers() {
    const renderTime = performance.now() - INTERP_DELAY;
    for (const id in otherPlayers) {
        const buf = otherPlayers[id].buffer;
        if (buf.length < 2) continue;

        let older = buf[0], newer = buf[1];
        for (let i = 0; i < buf.length - 1; i++) {
            if (buf[i].t <= renderTime && buf[i + 1].t >= renderTime) {
                older = buf[i];
                newer = buf[i + 1];
                break;
            }
        }

        const span = newer.t - older.t || 1;
        const t = Math.max(0, Math.min(1, (renderTime - older.t) / span));
        otherPlayers[id].renderX = older.x + (newer.x - older.x) * t;
        otherPlayers[id].renderY = older.y + (newer.y - older.y) * t;
    }
}

function update(dt) {
    if (!roundActive) return;

    const dtSec = dt / 1000;

    let moveX = 0, moveY = 0;
    if (keys['ArrowUp'] || keys['w']) moveY -= 1;
    if (keys['ArrowDown'] || keys['s']) moveY += 1;
    if (keys['ArrowLeft'] || keys['a']) moveX -= 1;
    if (keys['ArrowRight'] || keys['d']) moveX += 1;

    if (joystickActive) {
        moveX = joystickVector.x;
        moveY = joystickVector.y;
    }

    const mag = Math.sqrt(moveX * moveX + moveY * moveY);
    if (mag > 1) { moveX /= mag; moveY /= mag; }

    player.x += moveX * player.speed * dtSec;
    player.y += moveY * player.speed * dtSec;

    const r = 15;
    player.x = Math.max(r, Math.min(canvas.width - r, player.x));
    player.y = Math.max(r, Math.min(canvas.height - r, player.y));

    interpolateOthers();

    if (socket.readyState === WebSocket.OPEN && myId) {
        inputSeq++;
        const packet = { type: 'input', moveX, moveY, seq: inputSeq };
        pendingInputs.push(packet);
        socket.send(JSON.stringify(packet));
    }
}

function drawPlayer(x, y, color, isTagger) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = isTagger ? 25 : 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (isTagger) {
        const pulse = 4 * Math.sin(performance.now() / 150);
        ctx.strokeStyle = '#ffdd33';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 24 + pulse, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function render() {
    ctx.fillStyle = 'rgba(18, 18, 31, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawPlayer(player.x, player.y, myColor, myId === taggerId);

    for (const id in otherPlayers) {
        const p = otherPlayers[id];
        drawPlayer(p.renderX, p.renderY, p.color || '#f44', id === taggerId);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 18px Segoe UI';
    if (!roundActive) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 32px Segoe UI';
        ctx.fillStyle = winnerId === myId ? '#4dff88' : '#ff5566';
        ctx.fillText(winnerId === myId ? '🏆 YOU WIN!' : 'Game Over', canvas.width / 2, 60);
        ctx.font = '14px Segoe UI';
        ctx.fillStyle = '#ccc';
        ctx.fillText('Press R to restart', canvas.width / 2, 85);
        ctx.textAlign = 'left';
    } else if (myId === taggerId) {
        ctx.fillStyle = '#ffdd33';
        ctx.fillText('You are IT catch someone!', 20, 32);
    } else {
        ctx.fillStyle = '#66ddff';
        ctx.fillText('Run!', 20, 32);
    }
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'r' && !roundActive && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'restart' }));
    }
});

function loop(now) {
    const frameTime = now - lastTime;
    lastTime = now;
    accumulator += frameTime;

    while (accumulator >= TICK_MS) {
        update(TICK_MS);
        accumulator -= TICK_MS;
    }

    render();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'welcome') {
        myId = data.id;
        myColor = data.color;
        console.log('My ID:', myId, 'Color:', myColor);
    } else if (data.type === 'state') {
        taggerId = data.taggerId;
        roundActive = data.roundActive;
        winnerId = data.winnerId;

        const now = performance.now();
        for (const id in data.players) {
            if (id === myId) {
                const serverState = data.players[id];
                player.x = serverState.x;
                player.y = serverState.y;

                while (pendingInputs.length && pendingInputs[0].seq <= serverState.lastProcessedInput) {
                    pendingInputs.shift();
                }
                for (const inp of pendingInputs) {
                    const dtSec = 1 / 60;
                    player.x += inp.moveX * player.speed * dtSec;
                    player.y += inp.moveY * player.speed * dtSec;
                }
                continue;
            }
            if (!otherPlayers[id]) {
                otherPlayers[id] = { buffer: [], renderX: data.players[id].x, renderY: data.players[id].y, color: data.players[id].color };
            }
            otherPlayers[id].color = data.players[id].color;
            otherPlayers[id].buffer.push({ x: data.players[id].x, y: data.players[id].y, t: now });
            while (otherPlayers[id].buffer.length > 10) otherPlayers[id].buffer.shift();
        }
        for (const id in otherPlayers) {
            if (!(id in data.players) || id === myId) delete otherPlayers[id];
        }
    }
};