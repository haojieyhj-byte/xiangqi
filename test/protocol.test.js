import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const PORT = 18765;
let child;

function rpc(ws) {
  return {
    send(obj) {
      ws.send(JSON.stringify(obj));
    },
    next(pred = () => true, ms = 3000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
        const onMsg = (raw) => {
          const msg = JSON.parse(String(raw));
          if (msg.type === 'pong') return;
          if (!pred(msg)) return;
          clearTimeout(t);
          ws.off('message', onMsg);
          resolve(msg);
        };
        ws.on('message', onMsg);
      });
    },
  };
}

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('实时房间协议', () => {
  before(async () => {
    child = spawn('node', ['server/index.js'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    child.stdout.on('data', (d) => {
      if (String(d).includes('已启动')) ready = true;
    });
    for (let i = 0; i < 40 && !ready; i++) await sleep(50);
    if (!ready) throw new Error('server failed to start');
  });

  after(() => {
    if (child) child.kill('SIGTERM');
  });

  it('创建房间、加入、走棋同步、非法着法被拒绝、重连恢复', async () => {
    const hostWs = await open();
    const host = rpc(hostWs);
    host.send({ type: 'create' });
    const created = await host.next((m) => m.type === 'created');
    assert.equal(created.color, 'red');
    assert.match(created.roomCode, /^[A-Z2-9]{6}$/);
    assert.ok(created.inviteUrl.includes(created.roomCode));
    assert.ok(created.qr && created.qr.startsWith('data:image'));
    assert.equal(created.waiting, true);

    const guestWs = await open();
    const guest = rpc(guestWs);
    guest.send({ type: 'join', roomCode: created.roomCode });
    const joined = await guest.next((m) => m.type === 'joined');
    assert.equal(joined.color, 'black');
    assert.equal(joined.started, true);
    const hostStart = await host.next((m) => m.type === 'opponentJoined');
    assert.equal(hostStart.started, true);
    assert.equal(hostStart.game.turn, 'red');

    host.send({ type: 'move', from: { file: 4, rank: 3 }, to: { file: 4, rank: 4 } });
    const movedHost = await host.next((m) => m.type === 'moved');
    const movedGuest = await guest.next((m) => m.type === 'moved');
    assert.equal(movedHost.game.board[4][4], 'rP');
    assert.equal(movedGuest.game.board[4][4], 'rP');
    assert.equal(movedGuest.game.turn, 'black');

    guest.send({ type: 'move', from: { file: 4, rank: 6 }, to: { file: 4, rank: 8 } });
    const rejected = await guest.next((m) => m.type === 'error');
    assert.match(rejected.error, /规则|不合/);

    const token = created.token;
    const code = created.roomCode;
    hostWs.close();
    await sleep(80);

    const host2 = await open();
    const hostB = rpc(host2);
    hostB.send({ type: 'reconnect', roomCode: code, token });
    const rec = await hostB.next((m) => m.type === 'reconnected');
    assert.equal(rec.color, 'red');
    assert.equal(rec.game.board[4][4], 'rP');
    assert.equal(rec.game.turn, 'black');

    guest.send({ type: 'resign' });
    const over = await hostB.next((m) => m.type === 'resigned');
    assert.equal(over.game.status, 'red-win');
    assert.equal(over.game.reason, 'resign');

    host2.close();
    guestWs.close();
  });
});
