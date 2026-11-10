import {
  PIECE_CHARS,
  getLegalMovesFrom,
  RESULT,
  RED,
  BLACK,
  describeReason,
  pieceColor,
  pieceType,
  KING,
} from '/engine/rules.js';

const PAD = 10;
const CELL = 10;
const VB_W = 100;
const VB_H = 110;

const app = document.getElementById('app');

const ui = {
  screen: 'home',
  ws: null,
  reconnectTimer: null,
  heartbeatTimer: null,
  roomCode: null,
  token: null,
  color: null,
  inviteUrl: null,
  qr: null,
  snap: null,
  selected: null,
  legal: [],
  toast: '',
  toastTimer: null,
  rulesOpen: false,
  confirm: null,
  joinInput: '',
  connecting: false,
  lastError: '',
};

function isWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function canShare() {
  return typeof navigator.share === 'function';
}

function tokenKey(code) {
  return `xiangqi.session.${String(code || '').toUpperCase()}`;
}

function saveSession() {
  if (!ui.roomCode || !ui.token) return;
  localStorage.setItem(
    tokenKey(ui.roomCode),
    JSON.stringify({ token: ui.token, color: ui.color }),
  );
}

function loadSession(code) {
  try {
    return JSON.parse(localStorage.getItem(tokenKey(code)) || 'null');
  } catch {
    return null;
  }
}

function roomFromUrl() {
  const q = new URLSearchParams(location.search);
  const raw = q.get('r') || q.get('room') || '';
  return raw.trim().toUpperCase();
}

function setUrlRoom(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('r', code);
  else url.searchParams.delete('r');
  history.replaceState({}, '', url);
}

function toast(text) {
  ui.toast = text;
  render();
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => {
    ui.toast = '';
    render();
  }, 2200);
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function send(msg) {
  if (ui.ws && ui.ws.readyState === WebSocket.OPEN) {
    ui.ws.send(JSON.stringify(msg));
  }
}

function connect(onOpen) {
  if (ui.ws && (ui.ws.readyState === WebSocket.OPEN || ui.ws.readyState === WebSocket.CONNECTING)) {
    if (ui.ws.readyState === WebSocket.OPEN && onOpen) onOpen();
    return;
  }
  ui.connecting = true;
  const ws = new WebSocket(wsUrl());
  ui.ws = ws;
  ws.addEventListener('open', () => {
    ui.connecting = false;
    startHeartbeat();
    if (onOpen) onOpen();
    render();
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleServer(msg);
  });
  ws.addEventListener('close', () => {
    stopHeartbeat();
    if (ui.ws === ws) ui.ws = null;
    scheduleReconnect();
    render();
  });
  ws.addEventListener('error', () => {
    /* close 会跟进 */
  });
}

function startHeartbeat() {
  stopHeartbeat();
  ui.heartbeatTimer = setInterval(() => send({ type: 'heartbeat' }), 20000);
}

function stopHeartbeat() {
  clearInterval(ui.heartbeatTimer);
  ui.heartbeatTimer = null;
}

function scheduleReconnect() {
  if (ui.screen === 'home' && !ui.roomCode) return;
  clearTimeout(ui.reconnectTimer);
  ui.reconnectTimer = setTimeout(() => {
    connect(() => {
      if (ui.roomCode && ui.token) {
        send({ type: 'reconnect', roomCode: ui.roomCode, token: ui.token });
      }
    });
  }, 900);
}

function applyIdentity(msg) {
  if (msg.roomCode) ui.roomCode = msg.roomCode;
  if (msg.token) ui.token = msg.token;
  if (msg.color || msg.you) ui.color = msg.color || msg.you;
  if (msg.inviteUrl) ui.inviteUrl = msg.inviteUrl;
  if (msg.qr) ui.qr = msg.qr;
  saveSession();
  if (ui.roomCode) setUrlRoom(ui.roomCode);
}

function handleServer(msg) {
  if (msg.type === 'pong') return;
  if (msg.type === 'error') {
    ui.lastError = msg.error || '出错了';
    toast(ui.lastError);
    if (msg.game) {
      ui.snap = msg;
      ui.selected = null;
      ui.legal = [];
    }
    render();
    return;
  }
  if (msg.type === 'left') {
    return;
  }
  if (
    msg.type === 'created' ||
    msg.type === 'joined' ||
    msg.type === 'reconnected' ||
    msg.type === 'state' ||
    msg.type === 'moved' ||
    msg.type === 'opponentJoined' ||
    msg.type === 'opponentLeft' ||
    msg.type === 'opponentReconnected' ||
    msg.type === 'resigned' ||
    msg.type === 'drawOffered' ||
    msg.type === 'drawAccepted' ||
    msg.type === 'drawDeclined' ||
    msg.type === 'rematchRequested' ||
    msg.type === 'rematchStarted'
  ) {
    applyIdentity(msg);
    ui.snap = msg;
    ui.screen = 'game';
    if (msg.type === 'moved' || msg.type === 'rematchStarted') {
      ui.selected = null;
      ui.legal = [];
    }
    if (msg.type === 'moved' && msg.game?.lastMove) {
      playMoveSound(Boolean(msg.game.lastMove.captured));
    }
    if (msg.type === 'opponentJoined') toast('对手已加入，开始对弈');
    if (msg.type === 'opponentReconnected') toast('对手已重新连接');
    if (msg.type === 'opponentLeft') toast('对方已断开，可等待其重连');
    if (msg.type === 'drawDeclined') toast('对方拒绝了和棋');
    if (msg.type === 'rematchStarted') toast('再来一局，双方交换红黑');
    render();
    return;
  }
}

function resetToHome() {
  if (ui.roomCode) send({ type: 'leave' });
  ui.screen = 'home';
  ui.snap = null;
  ui.selected = null;
  ui.legal = [];
  ui.roomCode = null;
  ui.token = null;
  ui.color = null;
  ui.inviteUrl = null;
  ui.qr = null;
  ui.confirm = null;
  ui.rulesOpen = false;
  setUrlRoom('');
  render();
}

function createGame() {
  connect(() => send({ type: 'create' }));
}

function joinGame(code) {
  const roomCode = String(code || ui.joinInput || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(roomCode)) {
    toast('请输入 6 位房间号');
    return;
  }
  const session = loadSession(roomCode);
  connect(() => {
    if (session?.token) {
      ui.token = session.token;
      ui.color = session.color;
      send({ type: 'reconnect', roomCode, token: session.token });
    } else {
      send({ type: 'join', roomCode });
    }
  });
}

function positionCounts() {
  const raw = ui.snap?.game?.positionCounts;
  return raw ? new Map(raw) : null;
}

function flipped() {
  return ui.color === BLACK;
}

function visOf(file, rank) {
  if (flipped()) return { file: 8 - file, rank: 9 - rank };
  return { file, rank };
}

function fromVis(vFile, vRank) {
  if (flipped()) return { file: 8 - vFile, rank: 9 - vRank };
  return { file: vFile, rank: vRank };
}

function pointStyle(file, rank) {
  const x = ((PAD + file * CELL) / VB_W) * 100;
  const y = ((PAD + (9 - rank) * CELL) / VB_H) * 100;
  return `left:${x}%;top:${y}%`;
}

function onPoint(file, rank) {
  const snap = ui.snap;
  if (!snap?.game || !snap.started || snap.game.status !== RESULT.PLAYING) return;
  if (snap.waiting) return;
  if (ui.color !== snap.game.turn) {
    const p = snap.game.board[rank][file];
    if (p && pieceColor(p) === ui.color) toast('还没轮到你');
    return;
  }
  const piece = snap.game.board[rank][file];
  const isLegalTarget = ui.legal.some((m) => m.to.file === file && m.to.rank === rank);
  if (ui.selected && isLegalTarget) {
    const from = ui.selected;
    ui.selected = null;
    ui.legal = [];
    render();
    send({ type: 'move', from, to: { file, rank } });
    return;
  }
  if (piece && pieceColor(piece) === ui.color) {
    if (ui.selected && ui.selected.file === file && ui.selected.rank === rank) {
      ui.selected = null;
      ui.legal = [];
    } else {
      ui.selected = { file, rank };
      ui.legal = getLegalMovesFrom(snap.game.board, file, rank, ui.color, positionCounts());
    }
    render();
    return;
  }
  ui.selected = null;
  ui.legal = [];
  render();
}

function playMoveSound(capture) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = capture ? 'triangle' : 'sine';
    o.frequency.value = capture ? 240 : 420;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    o.stop(ctx.currentTime + 0.13);
    setTimeout(() => ctx.close(), 300);
  } catch {
    /* ignore */
  }
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
      toast(okMsg);
    } catch {
      toast('复制失败，请长按手动复制');
    }
    input.remove();
  }
}

async function shareInvite() {
  const url = ui.inviteUrl || `${location.origin}/?r=${ui.roomCode}`;
  const data = {
    title: '中国象棋 · 邀请你来一局',
    text: `房间号 ${ui.roomCode}，点开即可和我下一盘中国象棋`,
    url,
  };
  if (canShare()) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  copyText(url, '邀请链接已复制，可发给微信好友');
}

function gridSvg() {
  const lines = [];
  const s = (x1, y1, x2, y2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  const X = (f) => PAD + f * CELL;
  const Y = (r) => PAD + (9 - r) * CELL;
  for (let r = 0; r < 10; r++) {
    lines.push(s(X(0), Y(r), X(8), Y(r)));
  }
  for (let f = 0; f < 9; f++) {
    lines.push(s(X(f), Y(0), X(f), Y(4)));
    lines.push(s(X(f), Y(5), X(f), Y(9)));
  }
  lines.push(s(X(3), Y(0), X(5), Y(2)));
  lines.push(s(X(5), Y(0), X(3), Y(2)));
  lines.push(s(X(3), Y(9), X(5), Y(7)));
  lines.push(s(X(5), Y(9), X(3), Y(7)));
  const marks = [
    [1, 2],
    [7, 2],
    [1, 7],
    [7, 7],
    [0, 3],
    [2, 3],
    [4, 3],
    [6, 3],
    [8, 3],
    [0, 6],
    [2, 6],
    [4, 6],
    [6, 6],
    [8, 6],
  ];
  const tick = 1.6;
  const gap = 0.7;
  for (const [f, r] of marks) {
    const x = X(f);
    const y = Y(r);
    const quads = [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ];
    for (const [dx, dy] of quads) {
      const nx = f + dx;
      const ny = r + dy;
      if (nx < 0 || nx > 8) continue;
      if ((r === 4 && dy === 1) || (r === 5 && dy === -1)) continue;
      const ix = x + dx * gap;
      const iy = y - dy * gap;
      lines.push(s(ix, iy, ix, iy - dy * tick));
      lines.push(s(ix, iy, ix + dx * tick, iy));
    }
  }
  return `<svg class="grid" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="none"/>
    <g fill="none" stroke="#4a2f16" stroke-width="0.42" stroke-linecap="square">
      ${lines.join('')}
    </g>
    <rect x="${PAD}" y="${PAD}" width="${8 * CELL}" height="${9 * CELL}" fill="none" stroke="#3a2210" stroke-width="0.7"/>
  </svg>`;
}

function colorName(c) {
  return c === RED ? '红方' : '黑方';
}

function statusText() {
  const snap = ui.snap;
  if (!snap) return '';
  if (!snap.started || snap.waiting) return '等待对手加入…';
  const g = snap.game;
  if (g.status !== RESULT.PLAYING) {
    const reason = snap.reasonText || describeReason(g.reason);
    if (g.status === RESULT.DRAW) return `和棋${reason ? ' · ' + reason : ''}`;
    const winner = g.status === RESULT.RED_WIN ? '红方胜' : '黑方胜';
    return `${reason} · ${winner}`;
  }
  if (g.inCheck) return '将军！';
  return ui.color === g.turn ? '轮到你走棋' : `等待${colorName(g.turn)}走棋`;
}

function renderHome() {
  const wechat = isWeChat();
  return `
    <section class="screen home">
      <div class="brand">
        <div class="brand-mark">帅</div>
        <h1>中国象棋</h1>
        <p>邀好友 实时对弈</p>
      </div>
      <div class="panel">
        <button class="btn btn-primary" data-act="create">创建对局</button>
        <div class="or">或输入房间号加入</div>
        <div class="join-row">
          <input
            id="join-code"
            maxlength="6"
            placeholder="房间号"
            value="${escapeAttr(ui.joinInput)}"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
          />
          <button class="btn btn-ghost" data-act="join" style="width:112px">加入</button>
        </div>
      </div>
      ${
        wechat
          ? `<div class="wechat-tip">若页面无法打开或对弈异常，请点击右上角「···」，选择「在浏览器中打开」。</div>`
          : `<p class="home-foot">创建房间后，把链接、房间号或二维码发给微信好友即可开局。</p>`
      }
    </section>
  `;
}

function renderWaiting() {
  const url = ui.inviteUrl || `${location.origin}/?r=${ui.roomCode}`;
  const wechat = isWeChat();
  return `
    <section class="screen waiting">
      <h2>等待对手加入</h2>
      <p class="sub">你执红方 · 好友加入后执黑方</p>
      <div class="room-code-xl">${ui.roomCode || ''}</div>
      ${
        ui.qr
          ? `<div class="qr-wrap"><img alt="邀请二维码" src="${ui.qr}" /></div>
             <p class="qr-caption">请好友用微信扫一扫加入</p>`
          : `<p class="qr-caption">正在生成二维码…</p>`
      }
      <div class="invite-actions">
        <button class="btn btn-ghost btn-mini" data-act="copy-code">复制房间号</button>
        <button class="btn btn-ghost btn-mini" data-act="copy-link">复制链接</button>
        <button class="btn btn-primary btn-share" data-act="share">发给微信好友</button>
        <button class="btn btn-ghost btn-mini" data-act="home" style="grid-column:1/-1">返回首页</button>
      </div>
      ${
        wechat
          ? `<div class="wechat-tip">分享后若好友打不开，请让对方在微信中选择「在浏览器中打开」。本页也可直接把房间号发给对方。</div>`
          : `<p class="home-foot">同一网络可用链接直接打开；发给微信好友建议使用已部署的 HTTPS 地址。</p>`
      }
    </section>
  `;
}

function renderBoard() {
  const g = ui.snap.game;
  const last = g.lastMove;
  const points = [];
  const pieces = [];
  for (let rank = 0; rank < 10; rank++) {
    for (let file = 0; file < 9; file++) {
      const vis = visOf(file, rank);
      const style = pointStyle(vis.file, vis.rank);
      const classes = ['point'];
      const isSel = ui.selected && ui.selected.file === file && ui.selected.rank === rank;
      const legal = ui.legal.find((m) => m.to.file === file && m.to.rank === rank);
      if (legal) classes.push(g.board[rank][file] ? 'capture' : 'legal');
      if (last && last.from.file === file && last.from.rank === rank) classes.push('last');
      if (last && last.to.file === file && last.to.rank === rank) classes.push('last');
      points.push(
        `<button class="${classes.join(' ')}" style="${style}" data-file="${file}" data-rank="${rank}" type="button"><span class="mark"></span></button>`,
      );
      const p = g.board[rank][file];
      if (p) {
        const pc = pieceColor(p);
        const cls = ['piece', pc];
        if (isSel) cls.push('selected');
        if (g.inCheck && pieceType(p) === KING && pc === g.turn) cls.push('check-king');
        pieces.push(
          `<div class="${cls.join(' ')}" style="${style}">${PIECE_CHARS[p]}</div>`,
        );
      }
    }
  }
  return `
    <div class="board-stage">
      <div class="board-frame">
        <div class="board ${flipped() ? 'flipped' : ''}">
          ${gridSvg()}
          <div class="river-label"><span>楚河</span><span>汉界</span></div>
          ${points.join('')}
          ${pieces.join('')}
        </div>
      </div>
    </div>
  `;
}

function renderGame() {
  const snap = ui.snap;
  const waiting = !snap.started || snap.waiting;
  const g = snap.game;
  const you = colorName(ui.color);
  const oppConnected = ui.color === RED ? snap.players?.black?.connected : snap.players?.red?.connected;
  const selfConnected = true;
  const st = statusText();
  const stClass = g?.inCheck && g.status === RESULT.PLAYING ? 'check' : waiting || (g && ui.color !== g.turn && g.status === RESULT.PLAYING) ? 'wait' : '';
  if (waiting) return renderWaiting();
  return `
    <section class="screen game">
      <div class="topbar">
        <div class="left"><span class="pill">${you} · 房间 ${ui.roomCode || ''}</span></div>
        <div></div>
        <div class="right">
          <span class="pill"><span class="dot ${oppConnected ? 'on' : 'off'}"></span>${oppConnected ? '对手在线' : '对手离线'}</span>
        </div>
      </div>
      <div class="status-bar ${stClass}">${st}</div>
      ${renderBoard()}
      <div class="actions">
        <button class="btn btn-ghost btn-mini" data-act="resign" ${g.status !== RESULT.PLAYING ? 'disabled' : ''}>认输</button>
        <button class="btn btn-ghost btn-mini" data-act="draw" ${g.status !== RESULT.PLAYING ? 'disabled' : ''}>求和</button>
        <button class="btn btn-ghost btn-mini" data-act="rules">规则</button>
        <button class="btn btn-ghost btn-mini" data-act="invite">邀请</button>
      </div>
      <div class="notice">${g.drawOffer === ui.color ? '已向对方求和，等待回应。' : (snap.players?.black?.connected === false || snap.players?.red?.connected === false ? '有一方离线，可用同一链接重新进入恢复棋局。' : '')}</div>
    </section>
    ${renderModals()}
  `;
}

function resultTitle() {
  const g = ui.snap.game;
  if (g.status === RESULT.DRAW) return '和棋';
  const youWin = (g.status === RESULT.RED_WIN && ui.color === RED) || (g.status === RESULT.BLACK_WIN && ui.color === BLACK);
  return youWin ? '你赢了' : '你输了';
}

function renderModals() {
  const g = ui.snap?.game;
  if (!g) return '';
  const parts = [];
  if (g.status !== RESULT.PLAYING) {
    const waitingRematch = g.rematch && g.rematch[ui.color];
    const oppKey = ui.color === RED ? BLACK : RED;
    const oppAsked = g.rematch && g.rematch[oppKey];
    parts.push(`
      <div class="overlay">
        <div class="modal">
          <h3>${resultTitle()}</h3>
          <p>${statusText()}${oppAsked && !waitingRematch ? '<br>对方想再来一局' : ''}${waitingRematch ? '<br>已发起再来一局，等待对方同意' : ''}</p>
          <div class="row">
            <button class="btn btn-primary" data-act="rematch">${waitingRematch ? '等待中…' : '再来一局'}</button>
            <button class="btn btn-ghost" data-act="home">返回首页</button>
          </div>
        </div>
      </div>
    `);
  }
  if (g.status === RESULT.PLAYING && g.drawOffer && g.drawOffer !== ui.color) {
    parts.push(`
      <div class="overlay">
        <div class="modal">
          <h3>对方请求和棋</h3>
          <p>是否同意和棋？</p>
          <div class="row">
            <button class="btn btn-primary" data-act="draw-accept">同意</button>
            <button class="btn btn-ghost" data-act="draw-decline">拒绝</button>
          </div>
        </div>
      </div>
    `);
  }
  if (ui.confirm === 'resign') {
    parts.push(`
      <div class="overlay">
        <div class="modal">
          <h3>确认认输？</h3>
          <p>认输后本局即判负，可再邀请对手重开一局。</p>
          <div class="row">
            <button class="btn btn-danger" data-act="resign-yes">认输</button>
            <button class="btn btn-ghost" data-act="resign-no">取消</button>
          </div>
        </div>
      </div>
    `);
  }
  if (ui.confirm === 'invite') {
    parts.push(`
      <div class="overlay">
        <div class="modal">
          <h3>邀请好友</h3>
          <p>房间号 ${ui.roomCode}<br>把链接或二维码发给微信好友，点开即可加入。</p>
          ${ui.qr ? `<div class="qr-wrap" style="display:inline-block;margin-bottom:12px"><img alt="邀请二维码" src="${ui.qr}" style="width:180px;height:180px"/></div>` : ''}
          <div class="row" style="margin-bottom:10px">
            <button class="btn btn-ghost btn-mini" data-act="copy-code">复制房间号</button>
            <button class="btn btn-ghost btn-mini" data-act="copy-link">复制链接</button>
          </div>
          <button class="btn btn-primary" data-act="share">发给微信好友</button>
          <button class="btn btn-ghost" data-act="invite-close" style="margin-top:10px;width:100%">关闭</button>
        </div>
      </div>
    `);
  }
  if (ui.rulesOpen) {
    parts.push(`
      <div class="overlay">
        <div class="modal">
          <h3>规则说明</h3>
          <div class="rules-body scrollable">
            <h4>棋盘与走法</h4>
            <ul>
              <li>帅/将：九宫内一次走一格直线；两将不能在同一路上隔空对脸（飞将）。</li>
              <li>仕/士：九宫内一次走一格斜线。</li>
              <li>相/象：走田字，不能过河；田心有子则塞象眼，不能走。</li>
              <li>马：走日字；近处直行一格有子则蹩马腿。</li>
              <li>车：直线行走，不能跳子。</li>
              <li>炮：不吃子时与车相同；吃子必须恰好隔一个炮架。</li>
              <li>兵/卒：未过河只能向前；过河后可向前或横走，不能后退。</li>
            </ul>
            <h4>胜负</h4>
            <ul>
              <li>走子后不能让己方将/帅被将军，否则该着非法。</li>
              <li>对方无合法着法且已被将军，为将死。</li>
              <li>对方无合法着法但未被将军，为困毙，同样判负。</li>
              <li>可认输；求和需对方同意。</li>
            </ul>
            <h4>长将（简化）</h4>
            <p>同一将军局面重复出现三次时，禁止再走该着。若因此没有其他可走之着，则判长将违规负。本规则为便于对弈的简化约定，与正式竞赛中的长将、长捉细则并不完全等同。</p>
          </div>
          <button class="btn btn-primary" data-act="rules-close" style="margin-top:12px;width:100%">关闭</button>
        </div>
      </div>
    `);
  }
  return parts.join('');
}

function escapeAttr(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function render() {
  const toastHtml = ui.toast ? `<div class="toast">${escapeAttr(ui.toast)}</div>` : '';
  if (ui.screen === 'home' || !ui.snap) {
    app.innerHTML = renderHome() + toastHtml;
  } else {
    app.innerHTML = renderGame() + toastHtml;
  }
  bind();
}

function bind() {
  app.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', onAction);
  });
  app.querySelectorAll('.point').forEach((el) => {
    el.addEventListener('click', () => {
      onPoint(Number(el.dataset.file), Number(el.dataset.rank));
    });
  });
  const input = app.querySelector('#join-code');
  if (input) {
    input.addEventListener('input', (e) => {
      ui.joinInput = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      e.target.value = ui.joinInput;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinGame(ui.joinInput);
    });
  }
}

function onAction(e) {
  const act = e.currentTarget.getAttribute('data-act');
  switch (act) {
    case 'create':
      createGame();
      break;
    case 'join':
      joinGame();
      break;
    case 'home':
      resetToHome();
      break;
    case 'copy-code':
      copyText(ui.roomCode || '', '房间号已复制');
      break;
    case 'copy-link':
      copyText(ui.inviteUrl || `${location.origin}/?r=${ui.roomCode}`, '邀请链接已复制');
      break;
    case 'share':
      shareInvite();
      break;
    case 'resign':
      ui.confirm = 'resign';
      render();
      break;
    case 'resign-yes':
      ui.confirm = null;
      send({ type: 'resign' });
      render();
      break;
    case 'resign-no':
      ui.confirm = null;
      render();
      break;
    case 'draw':
      send({ type: 'drawOffer' });
      break;
    case 'draw-accept':
      send({ type: 'drawAccept' });
      break;
    case 'draw-decline':
      send({ type: 'drawDecline' });
      break;
    case 'rematch':
      send({ type: 'rematch' });
      break;
    case 'rules':
      ui.rulesOpen = true;
      render();
      break;
    case 'rules-close':
      ui.rulesOpen = false;
      render();
      break;
    case 'invite':
      ui.confirm = 'invite';
      render();
      if (!ui.qr && ui.roomCode) fetchQr();
      break;
    case 'invite-close':
    case 'noop':
      ui.confirm = null;
      render();
      break;
    default:
      break;
  }
}

async function fetchQr() {
  try {
    const res = await fetch(`/api/invite-qr?r=${encodeURIComponent(ui.roomCode)}`);
    const data = await res.json();
    if (data.ok) {
      ui.qr = data.qr;
      if (data.url) ui.inviteUrl = data.url;
      render();
    }
  } catch {
    /* ignore */
  }
}

function preventBounce() {
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.target.closest('.scrollable')) return;
      e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'gesturestart',
    (e) => e.preventDefault(),
    { passive: false },
  );
}

function boot() {
  preventBounce();
  render();
  const code = roomFromUrl();
  if (code) {
    ui.joinInput = code;
    joinGame(code);
  }
}

boot();
