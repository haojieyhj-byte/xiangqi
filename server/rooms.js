import { randomBytes } from 'node:crypto';
import {
  createGameState,
  applyMove,
  applyResign,
  offerDraw,
  respondDraw,
  requestRematch,
  publicState,
  RED,
  BLACK,
  opponent,
} from '../engine/rules.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const EMPTY_TTL_MS = 60 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 75 * 1000;

export function generateRoomCode() {
  let code = '';
  const bytes = randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

function newToken() {
  return randomBytes(24).toString('hex');
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom() {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const token = newToken();
    const room = {
      code,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      emptySince: null,
      game: createGameState(),
      started: false,
      players: {
        red: { token, connected: false, ws: null, lastSeen: Date.now() },
        black: null,
      },
    };
    this.rooms.set(code, room);
    return { room, color: RED, token };
  }

  get(code) {
    if (!code) return null;
    return this.rooms.get(String(code).trim().toUpperCase()) || null;
  }

  #touch(room, connectedCount) {
    room.lastActivity = Date.now();
    if (connectedCount === 0) {
      if (!room.emptySince) room.emptySince = Date.now();
    } else {
      room.emptySince = null;
    }
  }

  #connectedCount(room) {
    let n = 0;
    if (room.players.red?.connected) n++;
    if (room.players.black?.connected) n++;
    return n;
  }

  attach(room, color, ws) {
    const seat = room.players[color];
    if (!seat) return false;
    if (seat.ws && seat.ws !== ws) {
      try {
        seat.ws.close(4000, 'replaced');
      } catch {
        /* ignore */
      }
    }
    seat.ws = ws;
    seat.connected = true;
    seat.lastSeen = Date.now();
    this.#touch(room, this.#connectedCount(room));
    return true;
  }

  detach(ws) {
    const found = this.findByWs(ws);
    if (!found) return null;
    const { room, color } = found;
    const seat = room.players[color];
    if (seat && seat.ws === ws) {
      seat.ws = null;
      seat.connected = false;
      seat.lastSeen = Date.now();
    }
    this.#touch(room, this.#connectedCount(room));
    return found;
  }

  findByWs(ws) {
    for (const room of this.rooms.values()) {
      for (const color of [RED, BLACK]) {
        if (room.players[color]?.ws === ws) return { room, color };
      }
    }
    return null;
  }

  findSeat(code, token) {
    const room = this.get(code);
    if (!room || !token) return null;
    for (const color of [RED, BLACK]) {
      if (room.players[color]?.token === token) return { room, color };
    }
    return null;
  }

  joinRoom(code) {
    const room = this.get(code);
    if (!room) return { ok: false, error: '房间不存在或已过期' };
    if (room.players.black) {
      return { ok: false, error: '房间已满，请确认房间号，或用原来的链接重新进入' };
    }
    const token = newToken();
    room.players.black = { token, connected: false, ws: null, lastSeen: Date.now() };
    room.started = true;
    room.emptySince = null;
    room.lastActivity = Date.now();
    return { ok: true, room, color: BLACK, token };
  }

  reconnect(code, token) {
    const found = this.findSeat(code, token);
    if (!found) return { ok: false, error: '重连失败，房间不存在或身份已失效' };
    return { ok: true, room: found.room, color: found.color, token };
  }

  heartbeat(room, color) {
    const seat = room.players[color];
    if (seat) seat.lastSeen = Date.now();
    room.lastActivity = Date.now();
  }

  move(room, color, from, to) {
    if (!room.started || !room.players.black) {
      return { ok: false, error: '还在等待对手加入' };
    }
    return applyMove(room.game, from, to, color);
  }

  resign(room, color) {
    if (!room.started) return { ok: false, error: '对局尚未开始' };
    return applyResign(room.game, color);
  }

  offerDraw(room, color) {
    if (!room.started) return { ok: false, error: '对局尚未开始' };
    return offerDraw(room.game, color);
  }

  respondDraw(room, color, accept) {
    return respondDraw(room.game, color, accept);
  }

  rematch(room, color) {
    const result = requestRematch(room.game, color);
    if (!result.ok) return result;
    if (result.rematchReady) {
      const red = room.players.red;
      const black = room.players.black;
      room.players.red = black;
      room.players.black = red;
      room.game = result.state;
      room.lastActivity = Date.now();
      return { ok: true, rematchReady: true, swapped: true };
    }
    room.game = result.state;
    return { ok: true, rematchReady: false, swapped: false };
  }

  snapshot(room) {
    return {
      roomCode: room.code,
      started: room.started,
      waiting: !room.started || !room.players.black,
      players: {
        red: { connected: Boolean(room.players.red?.connected) },
        black: { connected: Boolean(room.players.black?.connected) },
      },
      game: publicState(room.game),
    };
  }

  broadcast(room, payload, exceptWs = null) {
    const data = JSON.stringify(payload);
    for (const color of [RED, BLACK]) {
      const ws = room.players[color]?.ws;
      if (ws && ws.readyState === 1 && ws !== exceptWs) {
        try {
          ws.send(data);
        } catch {
          /* ignore */
        }
      }
    }
  }

  send(ws, payload) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }

  sweepExpired(now = Date.now()) {
    const removed = [];
    for (const [code, room] of this.rooms) {
      const emptyFor = room.emptySince ? now - room.emptySince : 0;
      const staleHeartbeat = [...[room.players.red, room.players.black]].every((p) => {
        if (!p) return true;
        if (p.connected && p.ws && p.ws.readyState === 1) {
          if (now - p.lastSeen > HEARTBEAT_TIMEOUT_MS) {
            p.connected = false;
            try {
              p.ws.close(4001, 'heartbeat');
            } catch {
              /* ignore */
            }
            p.ws = null;
          } else {
            return false;
          }
        }
        return !p.connected;
      });
      if (staleHeartbeat && !room.emptySince) room.emptySince = now;
      if (room.emptySince && now - room.emptySince >= EMPTY_TTL_MS) {
        this.rooms.delete(code);
        removed.push(code);
      } else if (!room.players.black && now - room.createdAt >= EMPTY_TTL_MS && this.#connectedCount(room) === 0) {
        this.rooms.delete(code);
        removed.push(code);
      }
      void emptyFor;
    }
    return removed;
  }

  opponentColor(color) {
    return opponent(color);
  }
}
