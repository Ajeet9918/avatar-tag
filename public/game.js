let myId = null;
let myColor = '#4af';
let taggerId = null;
let roundActive = true;
let winnerId = null;

const socket = new WebSocket(`ws://${location.host}`);

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
    if (!roundActive) return; // freeze movement after game over

    const dtSec = dt / 1000;
    const input = {
        up: keys['ArrowUp'] || keys['w'],
        down: keys['ArrowDown'] || keys['s'],
        left: keys['ArrowLeft'] || keys['a'],
        right: keys['ArrowRight'] || keys['d'],
    };

    if (input.up) player.y -= player.speed * dtSec;
    if (input.down) player.y += player.speed * dtSec;
    if (input.left) player.x -= player.speed * dtSec;
    if (input.right) player.x += player.speed * dtSec;

    const r = 15;
    player.x = Math.max(r, Math.min(canvas.width - r, player.x));
    player.y = Math.max(r, Math.min(canvas.height - r, player.y));

    interpolateOthers();

    if (socket.readyState === WebSocket.OPEN && myId) {
        inputSeq++;
        const packet = { type: 'input', keys: input, seq: inputSeq };
        pendingInputs.push(packet);
        socket.send(JSON.stringify(packet));
    }
}

function drawItRing(x, y) {
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.stroke();
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = myColor;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
    ctx.fill();
    if (myId === taggerId) drawItRing(player.x, player.y);

    for (const id in otherPlayers) {
        const p = otherPlayers[id];
        ctx.fillStyle = p.color || '#f44';
        ctx.beginPath();
        ctx.arc(p.renderX, p.renderY, 15, 0, Math.PI * 2);
        ctx.fill();
        if (id === taggerId) drawItRing(p.renderX, p.renderY);
    }

    // status banner
    ctx.fillStyle = '#fff';
    ctx.font = '20px sans-serif';
    if (!roundActive) {
        const text = winnerId === myId ? 'YOU WIN!' : 'Game Over';
        ctx.fillText(text, canvas.width / 2 - 60, 40);
        ctx.font = '14px sans-serif';
        ctx.fillText('Refresh or press R to restart', canvas.width / 2 - 90, 65);
    } else if (myId === taggerId) {
        ctx.fillText('You are IT — catch someone!', 20, 30);
    } else {
        ctx.fillText('Run!', 20, 30);
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
                    if (inp.keys.up) player.y -= player.speed * dtSec;
                    if (inp.keys.down) player.y += player.speed * dtSec;
                    if (inp.keys.left) player.x -= player.speed * dtSec;
                    if (inp.keys.right) player.x += player.speed * dtSec;
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