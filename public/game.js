let myId = null;
let myColor = '#4af';
let taggerId = null;
let roundActive = true;
let winnerId = null;

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
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
    // fading trail effect instead of a hard clear
    ctx.fillStyle = 'rgba(18, 18, 31, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawPlayer(player.x, player.y, myColor, myId === taggerId);

    for (const id in otherPlayers) {
        const p = otherPlayers[id];
        drawPlayer(p.renderX, p.renderY, p.color || '#f44', id === taggerId);
    }

    // HUD panel
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