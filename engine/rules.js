/** 中国象棋规则引擎（服务端权威校验也使用本模块） */

export const RED = 'red';
export const BLACK = 'black';

export const KING = 'K';
export const ADVISOR = 'A';
export const ELEPHANT = 'E';
export const HORSE = 'H';
export const CHARIOT = 'R';
export const CANNON = 'C';
export const PAWN = 'P';

export const FILES = 9;
export const RANKS = 10;

export const PIECE_CHARS = {
  rK: '帅',
  rA: '仕',
  rE: '相',
  rH: '马',
  rR: '车',
  rC: '炮',
  rP: '兵',
  bK: '将',
  bA: '士',
  bE: '象',
  bH: '马',
  bR: '车',
  bC: '炮',
  bP: '卒',
};

export const PIECE_NAMES = {
  K: '帅/将',
  A: '仕/士',
  E: '相/象',
  H: '马',
  R: '车',
  C: '炮',
  P: '兵/卒',
};

const ORTHOGONAL = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const DIAGONAL = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function pieceColor(p) {
  return p[0] === 'r' ? RED : BLACK;
}

export function pieceType(p) {
  return p[1];
}

export function makePiece(color, type) {
  return (color === RED ? 'r' : 'b') + type;
}

export function opponent(color) {
  return color === RED ? BLACK : RED;
}

export function inBounds(file, rank) {
  return file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
}

export function inPalace(color, file, rank) {
  if (file < 3 || file > 5) return false;
  if (color === RED) return rank >= 0 && rank <= 2;
  return rank >= 7 && rank <= 9;
}

/** 当前格子是否已过河（兵/卒可横走的依据；相/象不可过河） */
export function hasCrossedRiver(color, rank) {
  return color === RED ? rank >= 5 : rank <= 4;
}

export function onOwnSideOfRiver(color, rank) {
  return color === RED ? rank <= 4 : rank >= 5;
}

export function emptyBoard() {
  return Array.from({ length: RANKS }, () => Array(FILES).fill(null));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function boardsEqual(a, b) {
  for (let r = 0; r < RANKS; r++) {
    for (let f = 0; f < FILES; f++) {
      if (a[r][f] !== b[r][f]) return false;
    }
  }
  return true;
}

export function initialBoard() {
  const b = emptyBoard();
  const back = [CHARIOT, HORSE, ELEPHANT, ADVISOR, KING, ADVISOR, ELEPHANT, HORSE, CHARIOT];
  for (let f = 0; f < FILES; f++) {
    b[0][f] = makePiece(RED, back[f]);
    b[9][f] = makePiece(BLACK, back[f]);
  }
  b[2][1] = makePiece(RED, CANNON);
  b[2][7] = makePiece(RED, CANNON);
  b[7][1] = makePiece(BLACK, CANNON);
  b[7][7] = makePiece(BLACK, CANNON);
  for (const f of [0, 2, 4, 6, 8]) {
    b[3][f] = makePiece(RED, PAWN);
    b[6][f] = makePiece(BLACK, PAWN);
  }
  return b;
}

export function findKing(board, color) {
  const target = makePiece(color, KING);
  for (let r = 0; r < RANKS; r++) {
    for (let f = 0; f < FILES; f++) {
      if (board[r][f] === target) return { file: f, rank: r };
    }
  }
  return null;
}

export function positionKey(board, turn) {
  let s = turn === RED ? 'r' : 'b';
  s += ':';
  for (let r = 0; r < RANKS; r++) {
    for (let f = 0; f < FILES; f++) {
      s += board[r][f] || '.';
    }
  }
  return s;
}

function sign(n) {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

function isEnemy(board, file, rank, color) {
  const p = board[rank][file];
  return p !== null && pieceColor(p) !== color;
}

function isEmpty(board, file, rank) {
  return board[rank][file] === null;
}

/** 生成某棋子的伪合法着法（含吃子，不含自将检测与长将检测） */
export function generatePseudoMoves(board, file, rank) {
  const piece = board[rank][file];
  if (!piece) return [];
  const color = pieceColor(piece);
  const type = pieceType(piece);
  switch (type) {
    case KING:
      return kingMoves(board, file, rank, color);
    case ADVISOR:
      return advisorMoves(board, file, rank, color);
    case ELEPHANT:
      return elephantMoves(board, file, rank, color);
    case HORSE:
      return horseMoves(board, file, rank, color);
    case CHARIOT:
      return chariotMoves(board, file, rank, color);
    case CANNON:
      return cannonMoves(board, file, rank, color);
    case PAWN:
      return pawnMoves(board, file, rank, color);
    default:
      return [];
  }
}

function canLand(board, file, rank, color) {
  if (!inBounds(file, rank)) return false;
  const p = board[rank][file];
  return p === null || pieceColor(p) !== color;
}

function kingMoves(board, file, rank, color) {
  const moves = [];
  for (const [df, dr] of ORTHOGONAL) {
    const nf = file + df;
    const nr = rank + dr;
    if (inPalace(color, nf, nr) && canLand(board, nf, nr, color)) {
      moves.push({ file: nf, rank: nr });
    }
  }
  return moves;
}

function advisorMoves(board, file, rank, color) {
  const moves = [];
  for (const [df, dr] of DIAGONAL) {
    const nf = file + df;
    const nr = rank + dr;
    if (inPalace(color, nf, nr) && canLand(board, nf, nr, color)) {
      moves.push({ file: nf, rank: nr });
    }
  }
  return moves;
}

function elephantMoves(board, file, rank, color) {
  const moves = [];
  for (const [df, dr] of DIAGONAL) {
    const nf = file + df * 2;
    const nr = rank + dr * 2;
    const eyeF = file + df;
    const eyeR = rank + dr;
    if (!inBounds(nf, nr)) continue;
    if (!onOwnSideOfRiver(color, nr)) continue; // 不能过河
    if (!isEmpty(board, eyeF, eyeR)) continue; // 塞象眼
    if (!canLand(board, nf, nr, color)) continue;
    moves.push({ file: nf, rank: nr });
  }
  return moves;
}

function horseMoves(board, file, rank, color) {
  const deltas = [
    [1, 2],
    [1, -2],
    [-1, 2],
    [-1, -2],
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
  ];
  const moves = [];
  for (const [df, dr] of deltas) {
    const nf = file + df;
    const nr = rank + dr;
    if (!inBounds(nf, nr)) continue;
    const legF = file + (Math.abs(df) === 2 ? sign(df) : 0);
    const legR = rank + (Math.abs(dr) === 2 ? sign(dr) : 0);
    if (!isEmpty(board, legF, legR)) continue; // 蹩马腿
    if (!canLand(board, nf, nr, color)) continue;
    moves.push({ file: nf, rank: nr });
  }
  return moves;
}

function chariotMoves(board, file, rank, color) {
  const moves = [];
  for (const [df, dr] of ORTHOGONAL) {
    let nf = file + df;
    let nr = rank + dr;
    while (inBounds(nf, nr)) {
      const p = board[nr][nf];
      if (p === null) {
        moves.push({ file: nf, rank: nr });
      } else {
        if (pieceColor(p) !== color) moves.push({ file: nf, rank: nr });
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  return moves;
}

function cannonMoves(board, file, rank, color) {
  const moves = [];
  for (const [df, dr] of ORTHOGONAL) {
    let nf = file + df;
    let nr = rank + dr;
    let jumped = false;
    while (inBounds(nf, nr)) {
      const p = board[nr][nf];
      if (!jumped) {
        if (p === null) {
          moves.push({ file: nf, rank: nr });
        } else {
          jumped = true; // 炮架
        }
      } else if (p !== null) {
        if (pieceColor(p) !== color) moves.push({ file: nf, rank: nr });
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  return moves;
}

function pawnMoves(board, file, rank, color) {
  const moves = [];
  const forward = color === RED ? 1 : -1;
  const nr = rank + forward;
  if (inBounds(file, nr) && canLand(board, file, nr, color)) {
    moves.push({ file, rank: nr });
  }
  if (hasCrossedRiver(color, rank)) {
    for (const df of [-1, 1]) {
      const nf = file + df;
      if (inBounds(nf, rank) && canLand(board, nf, rank, color)) {
        moves.push({ file: nf, rank });
      }
    }
  }
  return moves;
}

/**
 * 判断 (file, rank) 是否被 color 一方攻击（用于将军检测）。
 * 将/帅的「飞将」也视为攻击。
 */
export function isSquareAttacked(board, file, rank, byColor) {
  for (let r = 0; r < RANKS; r++) {
    for (let f = 0; f < FILES; f++) {
      const p = board[r][f];
      if (!p || pieceColor(p) !== byColor) continue;
      const type = pieceType(p);
      if (type === KING) {
        if (kingAttacks(board, f, r, file, rank)) return true;
      } else {
        const moves = generatePseudoMoves(board, f, r);
        if (moves.some((m) => m.file === file && m.rank === rank)) return true;
      }
    }
  }
  return false;
}

/** 将/帅：宫内一步正交，或同直线隔空对脸（飞将） */
function kingAttacks(board, fromFile, fromRank, toFile, toRank) {
  if (fromFile === toFile && fromRank === toRank) return false;
  const df = toFile - fromFile;
  const dr = toRank - fromRank;
  if (Math.abs(df) + Math.abs(dr) === 1) return true;
  if (df !== 0 && dr !== 0) return false;
  if (fromFile === toFile) {
    const step = sign(dr);
    for (let r = fromRank + step; r !== toRank; r += step) {
      if (board[r][fromFile]) return false;
    }
    return true;
  }
  // 将帅不能横线「飞将」，只在同一路（file）上对脸
  return false;
}

export function isInCheck(board, color) {
  const king = findKing(board, color);
  if (!king) return true;
  return isSquareAttacked(board, king.file, king.rank, opponent(color));
}

function applyOnBoard(board, from, to) {
  const next = cloneBoard(board);
  const piece = next[from.rank][from.file];
  next[to.rank][to.file] = piece;
  next[from.rank][from.file] = null;
  return next;
}

/**
 * 生成某方全部合法着法。
 * positionCounts: 走棋前的局面出现次数（用于长将三次限制）。
 */
export function getLegalMoves(board, color, positionCounts = null) {
  const moves = [];
  for (let r = 0; r < RANKS; r++) {
    for (let f = 0; f < FILES; f++) {
      const p = board[r][f];
      if (!p || pieceColor(p) !== color) continue;
      for (const dest of generatePseudoMoves(board, f, r)) {
        const next = applyOnBoard(board, { file: f, rank: r }, dest);
        if (isInCheck(next, color)) continue;
        if (isPerpetualCheckForbidden(board, next, color, positionCounts)) continue;
        moves.push({
          from: { file: f, rank: r },
          to: { file: dest.file, rank: dest.rank },
        });
      }
    }
  }
  return moves;
}

export function getLegalMovesFrom(board, file, rank, color, positionCounts = null) {
  return getLegalMoves(board, color, positionCounts).filter(
    (m) => m.from.file === file && m.from.rank === rank,
  );
}

/**
 * 简化长将规则：若这步是将军，且走完后的「对方待走局面」已经出现过两次
 * （本次将是第三次），则禁止该着。
 */
export function isPerpetualCheckForbidden(boardBefore, boardAfter, moverColor, positionCounts) {
  if (!positionCounts) return false;
  if (!isInCheck(boardAfter, opponent(moverColor))) return false;
  const key = positionKey(boardAfter, opponent(moverColor));
  const seen = positionCounts.get(key) || 0;
  return seen >= 2;
}

export function hasLegalMove(board, color, positionCounts = null) {
  return getLegalMoves(board, color, positionCounts).length > 0;
}

/** 是否存在仅因长将限制而被过滤的着法（用于区分困毙与长将判负） */
export function hasMovesOnlyBlockedByPerpetual(board, color, positionCounts) {
  if (!positionCounts) return false;
  let anyPseudoLegal = false;
  let anyNonPerpetual = false;
  let anyPerpetual = false;
  for (let r = 0; r < RANKS; r++) {
    for (let f = 0; f < FILES; f++) {
      const p = board[r][f];
      if (!p || pieceColor(p) !== color) continue;
      for (const dest of generatePseudoMoves(board, f, r)) {
        const next = applyOnBoard(board, { file: f, rank: r }, dest);
        if (isInCheck(next, color)) continue;
        anyPseudoLegal = true;
        if (isPerpetualCheckForbidden(board, next, color, positionCounts)) {
          anyPerpetual = true;
        } else {
          anyNonPerpetual = true;
        }
      }
    }
  }
  return anyPseudoLegal && anyPerpetual && !anyNonPerpetual;
}

export const RESULT = {
  PLAYING: 'playing',
  RED_WIN: 'red-win',
  BLACK_WIN: 'black-win',
  DRAW: 'draw',
};

export const REASON = {
  CHECKMATE: 'checkmate',
  STALEMATE: 'stalemate',
  PERPETUAL: 'perpetual-check',
  RESIGN: 'resign',
  DRAW: 'draw-agree',
};

export function outcomeAfterMove(board, nextTurn, positionCounts) {
  if (hasLegalMove(board, nextTurn, positionCounts)) {
    return { status: RESULT.PLAYING, reason: null, inCheck: isInCheck(board, nextTurn) };
  }
  const winner = nextTurn === RED ? RESULT.BLACK_WIN : RESULT.RED_WIN;
  if (isInCheck(board, nextTurn)) {
    return { status: winner, reason: REASON.CHECKMATE, inCheck: true };
  }
  if (hasMovesOnlyBlockedByPerpetual(board, nextTurn, positionCounts)) {
    return { status: winner, reason: REASON.PERPETUAL, inCheck: false };
  }
  return { status: winner, reason: REASON.STALEMATE, inCheck: false };
}

export function createGameState() {
  const board = initialBoard();
  const counts = new Map();
  const key = positionKey(board, RED);
  counts.set(key, 1);
  return {
    board,
    turn: RED,
    status: RESULT.PLAYING,
    reason: null,
    inCheck: false,
    lastMove: null,
    history: [],
    positionCounts: counts,
    drawOffer: null,
    rematch: { red: false, black: false },
  };
}

export function serializeState(state) {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    status: state.status,
    reason: state.reason,
    inCheck: state.inCheck,
    lastMove: state.lastMove ? { ...state.lastMove, from: { ...state.lastMove.from }, to: { ...state.lastMove.to } } : null,
    history: state.history.map((h) => ({ ...h, from: { ...h.from }, to: { ...h.to } })),
    positionCounts: [...state.positionCounts.entries()],
    drawOffer: state.drawOffer,
    rematch: { ...state.rematch },
  };
}

export function deserializeState(data) {
  return {
    board: cloneBoard(data.board),
    turn: data.turn,
    status: data.status,
    reason: data.reason,
    inCheck: data.inCheck,
    lastMove: data.lastMove || null,
    history: data.history || [],
    positionCounts: new Map(data.positionCounts || []),
    drawOffer: data.drawOffer ?? null,
    rematch: data.rematch || { red: false, black: false },
  };
}

export function validateMove(state, from, to, color) {
  if (state.status !== RESULT.PLAYING) return { ok: false, error: '对局已经结束' };
  if (color !== state.turn) return { ok: false, error: '还没轮到你' };
  if (!inBounds(from.file, from.rank) || !inBounds(to.file, to.rank)) {
    return { ok: false, error: '落点不在棋盘上' };
  }
  const piece = state.board[from.rank][from.file];
  if (!piece) return { ok: false, error: '起点没有棋子' };
  if (pieceColor(piece) !== color) return { ok: false, error: '只能走己方棋子' };
  const legal = getLegalMovesFrom(state.board, from.file, from.rank, color, state.positionCounts);
  const hit = legal.find((m) => m.to.file === to.file && m.to.rank === to.rank);
  if (!hit) {
    const next = applyOnBoard(state.board, from, to);
    const pseudo = generatePseudoMoves(state.board, from.file, from.rank);
    const isPseudo = pseudo.some((m) => m.file === to.file && m.rank === to.rank);
    if (isPseudo && isInCheck(next, color)) {
      return { ok: false, error: '不能送将，走完后己方帅/将仍被将军' };
    }
    if (isPseudo && isPerpetualCheckForbidden(state.board, next, color, state.positionCounts)) {
      return { ok: false, error: '长将禁止：同一将军局面不能重复三次' };
    }
    return { ok: false, error: '这步棋不合规则' };
  }
  return { ok: true };
}

export function applyMove(state, from, to, color) {
  const check = validateMove(state, from, to, color);
  if (!check.ok) return check;
  const piece = state.board[from.rank][from.file];
  const captured = state.board[to.rank][to.file];
  const board = applyOnBoard(state.board, from, to);
  const nextTurn = opponent(color);
  const key = positionKey(board, nextTurn);
  const positionCounts = new Map(state.positionCounts);
  positionCounts.set(key, (positionCounts.get(key) || 0) + 1);
  const end = outcomeAfterMove(board, nextTurn, positionCounts);
  const moveRecord = {
    from: { ...from },
    to: { ...to },
    piece,
    captured,
    color,
    check: end.inCheck,
    status: end.status,
    reason: end.reason,
  };
  return {
    ok: true,
    state: {
      board,
      turn: nextTurn,
      status: end.status,
      reason: end.reason,
      inCheck: end.inCheck,
      lastMove: { from: { ...from }, to: { ...to }, piece, captured },
      history: [...state.history, moveRecord],
      positionCounts,
      drawOffer: null,
      rematch: { red: false, black: false },
    },
  };
}

export function applyResign(state, color) {
  if (state.status !== RESULT.PLAYING) return { ok: false, error: '对局已经结束' };
  return {
    ok: true,
    state: {
      ...state,
      board: cloneBoard(state.board),
      status: color === RED ? RESULT.BLACK_WIN : RESULT.RED_WIN,
      reason: REASON.RESIGN,
      positionCounts: new Map(state.positionCounts),
      rematch: { red: false, black: false },
      drawOffer: null,
    },
  };
}

export function offerDraw(state, color) {
  if (state.status !== RESULT.PLAYING) return { ok: false, error: '对局已经结束' };
  if (state.drawOffer === color) return { ok: true, state };
  return {
    ok: true,
    state: {
      ...state,
      board: cloneBoard(state.board),
      positionCounts: new Map(state.positionCounts),
      drawOffer: color,
    },
  };
}

export function respondDraw(state, color, accept) {
  if (state.status !== RESULT.PLAYING) return { ok: false, error: '对局已经结束' };
  if (!state.drawOffer || state.drawOffer === color) {
    return { ok: false, error: '没有待处理的和棋请求' };
  }
  if (!accept) {
    return {
      ok: true,
      state: {
        ...state,
        board: cloneBoard(state.board),
        positionCounts: new Map(state.positionCounts),
        drawOffer: null,
      },
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      board: cloneBoard(state.board),
      positionCounts: new Map(state.positionCounts),
      status: RESULT.DRAW,
      reason: REASON.DRAW,
      drawOffer: null,
      rematch: { red: false, black: false },
    },
  };
}

export function requestRematch(state, color) {
  if (state.status === RESULT.PLAYING) return { ok: false, error: '对局尚未结束' };
  const rematch = { ...state.rematch, [color]: true };
  const both = rematch.red && rematch.black;
  if (!both) {
    return {
      ok: true,
      rematchReady: false,
      state: {
        ...state,
        board: cloneBoard(state.board),
        positionCounts: new Map(state.positionCounts),
        rematch,
      },
    };
  }
  return { ok: true, rematchReady: true, state: createGameState() };
}

export function publicState(state) {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    status: state.status,
    reason: state.reason,
    inCheck: state.inCheck,
    lastMove: state.lastMove,
    history: state.history,
    drawOffer: state.drawOffer,
    rematch: state.rematch,
    positionCounts: [...state.positionCounts.entries()],
  };
}

export function describeReason(reason) {
  switch (reason) {
    case REASON.CHECKMATE:
      return '将死';
    case REASON.STALEMATE:
      return '困毙';
    case REASON.PERPETUAL:
      return '长将违规';
    case REASON.RESIGN:
      return '认输';
    case REASON.DRAW:
      return '双方同意和棋';
    default:
      return '';
  }
}
