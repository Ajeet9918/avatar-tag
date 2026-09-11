const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'public', filePath);
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200);
        res.end(data);
    });
});

const wss = new WebSocketServer({ server });
const players = new Map(); // id -> { ws, x, y, lastProcessedInput, survivalStart, color }

const COLORS = ['#4af', '#f44', '#4f4', '#ff4', '#f4f', '#4ff'];
let colorIndex = 0;

let taggerId = null;
let lastTagTime = 0;
const TAG_RADIUS = 40;
const TAG_COOLDOWN_MS = 1000;

const WIN_TIME_MS = 60000; // 60s survived untagged = win
let roundActive = true;
let winnerId = null;

wss.on('connection', (ws) => {
    const id = crypto.randomUUID();
    const spawnX = 200 + Math.random() * 400;
    const spawnY = 200 + Math.random() * 200;
    const color = COLORS[colorIndex % COLORS.length];
    colorIndex++;

    players.set(id, {
        ws, x: spawnX, y: spawnY,
        lastProcessedInput: 0,
        survivalStart: Date.now(),
        color
    });

    if (taggerId === null) {
        taggerId = id;
    }

    console.log(`Player connected: ${id} (${color})`);
    ws.send(JSON.stringify({ type: 'welcome', id, color }));

    ws.on('message', (raw) => {
        const data = JSON.parse(raw);
        if (data.type === 'input' && roundActive) {
            const p = players.get(id);
            if (!p) return;
            const speed = 200;
            const dt = 1 / 60;
            if (data.keys.up) p.y -= speed * dt;
            if (data.keys.down) p.y += speed * dt;
            if (data.keys.left) p.x -= speed * dt;
            if (data.keys.right) p.x += speed * dt;

            const r = 15;
            p.x = Math.max(r, Math.min(800 - r, p.x));
            p.y = Math.max(r, Math.min(600 - r, p.y));

            p.lastProcessedInput = data.seq;
        } else if (data.type === 'restart') {
            roundActive = true;
            winnerId = null;
            for (const [, p] of players) {
                p.survivalStart = Date.now();
            }
        }
    });

    ws.on('close', () => {
        players.delete(id);
        console.log(`Player disconnected: ${id}`);
        if (taggerId === id) {
            const remaining = [...players.keys()];
            taggerId = remaining.length ? remaining[0] : null;
        }
    });
});

setInterval(() => {
    const now = Date.now();

    if (roundActive && taggerId && players.has(taggerId)) {
        // tag check
        if (now - lastTagTime > TAG_COOLDOWN_MS) {
            const tagger = players.get(taggerId);
            for (const [pid, p] of players) {
                if (pid === taggerId) continue;
                const dx = tagger.x - p.x;
                const dy = tagger.y - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < TAG_RADIUS) {
                    taggerId = pid;
                    lastTagTime = now;
                    p.survivalStart = now; // new tagger's clock resets on becoming it
                    console.log(`${pid} is now IT`);
                    break;
                }
            }
        }

        // win check — reset tagger's clock, check everyone else
        for (const [pid, p] of players) {
            if (pid === taggerId) {
                p.survivalStart = now;
                continue;
            }
            if (now - p.survivalStart >= WIN_TIME_MS) {
                roundActive = false;
                winnerId = pid;
                console.log(`${pid} WINS`);
                break;
            }
        }
    }

    const state = {};
    for (const [pid, p] of players) {
        state[pid] = {
            x: p.x, y: p.y,
            color: p.color,
            lastProcessedInput: p.lastProcessedInput || 0,
            survivedMs: roundActive ? now - p.survivalStart : 0
        };
    }
    const msg = JSON.stringify({
        type: 'state',
        players: state,
        taggerId,
        roundActive,
        winnerId
    });
    for (const [, p] of players) {
        if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
    }
}, 1000 / 20);

server.listen(3000, () => console.log('Server running on :3000'));