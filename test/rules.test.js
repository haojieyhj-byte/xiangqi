import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RED,
  BLACK,
  KING,
  ADVISOR,
  ELEPHANT,
  HORSE,
  CHARIOT,
  CANNON,
  PAWN,
  emptyBoard,
  initialBoard,
  makePiece,
  generatePseudoMoves,
  getLegalMoves,
  getLegalMovesFrom,
  isInCheck,
  isSquareAttacked,
  applyMove,
  createGameState,
  outcomeAfterMove,
  RESULT,
  REASON,
  inPalace,
  hasCrossedRiver,
  findKing,
  positionKey,
} from '../engine/rules.js';

function place(pieces) {
  const board = emptyBoard();
  for (const [file, rank, color, type] of pieces) {
    board[rank][file] = makePiece(color, type);
  }
  return board;
}

function destSet(moves) {
  return new Set(moves.map((m) => `${m.file},${m.rank}`));
}

function legalDestSet(board, file, rank, color, counts = null) {
  return new Set(
    getLegalMovesFrom(board, file, rank, color, counts).map((m) => `${m.to.file},${m.to.rank}`),
  );
}

describe('棋盘与开局', () => {
  it('开局棋子数量与将帅位置正确', () => {
    const b = initialBoard();
    let red = 0;
    let black = 0;
    for (let r = 0; r < 10; r++) {
      for (let f = 0; f < 9; f++) {
        const p = b[r][f];
        if (!p) continue;
        if (p[0] === 'r') red++;
        else black++;
      }
    }
    assert.equal(red, 16);
    assert.equal(black, 16);
    assert.deepEqual(findKing(b, RED), { file: 4, rank: 0 });
    assert.deepEqual(findKing(b, BLACK), { file: 4, rank: 9 });
    assert.equal(b[0][0], 'rR');
    assert.equal(b[9][8], 'bR');
    assert.equal(b[3][4], 'rP');
    assert.equal(b[6][4], 'bP');
  });

  it('九宫范围', () => {
    assert.equal(inPalace(RED, 4, 0), true);
    assert.equal(inPalace(RED, 3, 2), true);
    assert.equal(inPalace(RED, 2, 1), false);
    assert.equal(inPalace(RED, 4, 3), false);
    assert.equal(inPalace(BLACK, 4, 9), true);
    assert.equal(inPalace(BLACK, 5, 7), true);
    assert.equal(inPalace(BLACK, 4, 6), false);
  });
});

describe('帅/将', () => {
  it('只能在九宫内走一步正交', () => {
    const board = place([[4, 0, RED, KING]]);
    const moves = destSet(generatePseudoMoves(board, 4, 0));
    assert.deepEqual(moves, new Set(['3,0', '5,0', '4,1']));
  });

  it('不能走出九宫，也不能斜走或走两步', () => {
    const board = place([[3, 1, RED, KING]]);
    const moves = destSet(generatePseudoMoves(board, 3, 1));
    assert.equal(moves.has('2,1'), false);
    assert.equal(moves.has('3,3'), false);
    assert.equal(moves.has('4,2'), false);
    assert.equal(moves.has('4,0'), false);
    assert.ok(moves.has('3,0'));
    assert.ok(moves.has('3,2'));
    assert.ok(moves.has('4,1'));
  });

  it('黑将同样限制在黑方九宫', () => {
    const board = place([[4, 9, BLACK, KING]]);
    const moves = destSet(generatePseudoMoves(board, 4, 9));
    assert.deepEqual(moves, new Set(['3,9', '5,9', '4,8']));
  });
});

describe('仕/士', () => {
  it('只能在九宫内走一步斜线', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 1, RED, ADVISOR],
    ]);
    const moves = destSet(generatePseudoMoves(board, 4, 1));
    assert.deepEqual(moves, new Set(['3,0', '5,0', '3,2', '5,2']));
  });

  it('不能走出九宫或直走', () => {
    const board = place([
      [4, 0, RED, KING],
      [3, 0, RED, ADVISOR],
    ]);
    const moves = destSet(generatePseudoMoves(board, 3, 0));
    assert.deepEqual(moves, new Set(['4,1']));
    assert.equal(moves.has('2,1'), false);
    assert.equal(moves.has('3,1'), false);
  });
});

describe('相/象与塞象眼', () => {
  it('走田字且不能过河', () => {
    const board = place([
      [4, 0, RED, KING],
      [2, 0, RED, ELEPHANT],
    ]);
    const moves = destSet(generatePseudoMoves(board, 2, 0));
    assert.ok(moves.has('0,2'));
    assert.ok(moves.has('4,2'));
    assert.equal(moves.has('0,-2'), false);
  });

  it('红相不能过河', () => {
    const board = place([
      [4, 0, RED, KING],
      [2, 4, RED, ELEPHANT],
    ]);
    const moves = destSet(generatePseudoMoves(board, 2, 4));
    assert.equal(moves.has('0,6'), false);
    assert.equal(moves.has('4,6'), false);
    assert.ok(moves.has('0,2'));
    assert.ok(moves.has('4,2'));
  });

  it('黑象不能过河', () => {
    const board = place([
      [4, 9, BLACK, KING],
      [2, 5, BLACK, ELEPHANT],
    ]);
    const moves = destSet(generatePseudoMoves(board, 2, 5));
    assert.equal(moves.has('0,3'), false);
    assert.equal(moves.has('4,3'), false);
    assert.ok(moves.has('0,7'));
    assert.ok(moves.has('4,7'));
  });

  it('塞象眼：中间有子则不能走田', () => {
    const board = place([
      [4, 0, RED, KING],
      [2, 0, RED, ELEPHANT],
      [3, 1, BLACK, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(board, 2, 0));
    assert.equal(moves.has('4,2'), false);
    assert.ok(moves.has('0,2'));
  });
});

describe('马与蹩马腿', () => {
  it('日字可走八向', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 4, RED, HORSE],
    ]);
    const moves = destSet(generatePseudoMoves(board, 4, 4));
    assert.deepEqual(
      moves,
      new Set(['5,6', '5,2', '3,6', '3,2', '6,5', '6,3', '2,5', '2,3']),
    );
  });

  it('蹩马腿：前方有子则对应两向被挡', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 4, RED, HORSE],
      [4, 5, BLACK, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(board, 4, 4));
    assert.equal(moves.has('5,6'), false);
    assert.equal(moves.has('3,6'), false);
    assert.ok(moves.has('6,5'));
    assert.ok(moves.has('2,5'));
    assert.ok(moves.has('5,2'));
    assert.ok(moves.has('3,2'));
  });

  it('蹩马腿：侧向有子挡横向日步', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 4, RED, HORSE],
      [5, 4, RED, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(board, 4, 4));
    assert.equal(moves.has('6,5'), false);
    assert.equal(moves.has('6,3'), false);
    assert.ok(moves.has('5,6'));
    assert.ok(moves.has('5,2'));
  });
});

describe('车', () => {
  it('直线行走，不能跳子', () => {
    const board = place([
      [4, 0, RED, KING],
      [0, 0, RED, CHARIOT],
      [0, 5, BLACK, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(board, 0, 0));
    assert.ok(moves.has('0,1'));
    assert.ok(moves.has('0,4'));
    assert.ok(moves.has('0,5')); // 可吃卒
    assert.equal(moves.has('0,6'), false); // 不能跳
    assert.ok(moves.has('3,0'));
    assert.equal(moves.has('4,0'), false); // 己方帅
    assert.equal(moves.has('5,0'), false);
  });
});

describe('炮与炮架', () => {
  it('不吃子时与车相同，不能隔子落空', () => {
    const board = place([
      [4, 0, RED, KING],
      [0, 0, RED, CANNON],
      [0, 4, BLACK, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(board, 0, 0));
    assert.ok(moves.has('0,1'));
    assert.ok(moves.has('0,3'));
    assert.equal(moves.has('0,4'), false); // 不能直接吃相邻子
    assert.equal(moves.has('0,5'), false); // 隔一子后的空格不能走
  });

  it('吃子必须恰好隔一个炮架', () => {
    const board = place([
      [4, 0, RED, KING],
      [0, 0, RED, CANNON],
      [0, 4, RED, PAWN],
      [0, 7, BLACK, CHARIOT],
    ]);
    const moves = destSet(generatePseudoMoves(board, 0, 0));
    assert.ok(moves.has('0,7'));
    assert.equal(moves.has('0,4'), false);
  });

  it('隔两子不能吃（炮架过多）', () => {
    const board = place([
      [4, 0, RED, KING],
      [0, 0, RED, CANNON],
      [0, 3, RED, PAWN],
      [0, 5, BLACK, PAWN],
      [0, 7, BLACK, CHARIOT],
    ]);
    const moves = destSet(generatePseudoMoves(board, 0, 0));
    assert.equal(moves.has('0,7'), false);
    assert.ok(moves.has('0,5')); // 隔一个红兵可吃黑卒
  });

  it('不能隔炮架吃己方', () => {
    const board = place([
      [4, 0, RED, KING],
      [0, 1, RED, CANNON],
      [0, 3, BLACK, PAWN],
      [0, 5, RED, HORSE],
    ]);
    const moves = destSet(generatePseudoMoves(board, 0, 1));
    assert.equal(moves.has('0,5'), false);
  });
});

describe('兵/卒', () => {
  it('未过河只能向前', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 3, RED, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(board, 4, 3));
    assert.deepEqual(moves, new Set(['4,4']));
    assert.equal(hasCrossedRiver(RED, 3), false);
  });

  it('过河后可向前或横走，不可后退', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 5, RED, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(board, 4, 5));
    assert.deepEqual(moves, new Set(['4,6', '3,5', '5,5']));
    assert.equal(moves.has('4,4'), false);
  });

  it('黑卒方向相反，过河后同样不可后退', () => {
    const board = place([
      [4, 9, BLACK, KING],
      [4, 6, BLACK, PAWN],
    ]);
    assert.deepEqual(destSet(generatePseudoMoves(board, 4, 6)), new Set(['4,5']));
    const crossed = place([
      [4, 9, BLACK, KING],
      [4, 4, BLACK, PAWN],
    ]);
    const moves = destSet(generatePseudoMoves(crossed, 4, 4));
    assert.deepEqual(moves, new Set(['4,3', '3,4', '5,4']));
    assert.equal(moves.has('4,5'), false);
  });

  it('红兵从河界再进一步才算过河，刚到第5线即可横走', () => {
    const board = place([
      [4, 0, RED, KING],
      [2, 4, RED, PAWN],
    ]);
    const before = destSet(generatePseudoMoves(board, 2, 4));
    assert.deepEqual(before, new Set(['2,5']));
  });
});

describe('飞将', () => {
  it('两将同线隔空对脸视为被将军', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 9, BLACK, KING],
    ]);
    assert.equal(isInCheck(board, RED), true);
    assert.equal(isInCheck(board, BLACK), true);
    assert.equal(isSquareAttacked(board, 4, 0, BLACK), true);
  });

  it('中间有子则不对脸', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 5, RED, PAWN],
      [4, 9, BLACK, KING],
    ]);
    assert.equal(isInCheck(board, RED), false);
    assert.equal(isInCheck(board, BLACK), false);
  });

  it('走子后形成对脸为非法（不能送将）', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 5, RED, PAWN],
      [4, 9, BLACK, KING],
    ]);
    const legal = legalDestSet(board, 4, 5, RED);
    assert.equal(legal.has('3,5'), false);
    assert.equal(legal.has('5,5'), false);
    assert.ok(legal.has('4,6'));
  });
});

describe('不能送将', () => {
  it('被牵制的车不能移开暴露己方帅', () => {
    const board = place([
      [4, 0, RED, KING],
      [4, 3, RED, CHARIOT],
      [4, 9, BLACK, KING],
      [0, 9, BLACK, CHARIOT],
    ]);
    // 黑车在底线，不是对红帅的牵制。改用黑车在同一路将军方向
    const pinned = place([
      [4, 0, RED, KING],
      [4, 4, RED, CHARIOT],
      [4, 9, BLACK, CHARIOT],
      [3, 9, BLACK, KING],
    ]);
    const legal = legalDestSet(pinned, 4, 4, RED);
    assert.equal(legal.has('0,4'), false);
    assert.equal(legal.has('8,4'), false);
    assert.ok(legal.has('4,8') || legal.has('4,9') || legal.has('4,3'));
  });

  it('走闲着后若己方仍被将军则非法', () => {
    const board = place([
      [4, 0, RED, KING],
      [0, 0, RED, CHARIOT],
      [4, 8, BLACK, CHARIOT],
      [4, 9, BLACK, KING],
    ]);
    assert.equal(isInCheck(board, RED), true);
    const legalKing = legalDestSet(board, 4, 0, RED);
    assert.equal(legalKing.has('4,1'), false); // 仍在车口
    assert.ok(legalKing.has('3,0') || legalKing.has('5,0'));
    const legalRook = legalDestSet(board, 0, 0, RED);
    // 红车不能随便离开，除非能挡住或吃掉黑车（此局面吃不到）
    assert.equal([...legalRook].some((s) => s !== '4,0'), false);
  });
});

describe('将死与困毙', () => {
  it('双车错杀：简单将死', () => {
    // 黑将在宫顶，红双车占九、八两横，无其他子可挡
    const board = place([
      [4, 0, RED, KING],
      [0, 9, RED, CHARIOT],
      [0, 8, RED, CHARIOT],
      [4, 9, BLACK, KING],
    ]);
    assert.equal(isInCheck(board, BLACK), true);
    const legal = getLegalMoves(board, BLACK);
    assert.equal(legal.length, 0);
    const end = outcomeAfterMove(board, BLACK, null);
    assert.equal(end.status, RESULT.RED_WIN);
    assert.equal(end.reason, REASON.CHECKMATE);
    assert.equal(end.inCheck, true);
  });

  it('困毙：无将但无合法着法', () => {
    // 黑将(3,9)，双士(4,9)(3,8)堵死；红帅同路形成潜在飞将；
    // 红车在(8,9)牵住(4,9)士。黑方未被将军但无棋可走。
    const board = place([
      [3, 0, RED, KING],
      [8, 9, RED, CHARIOT],
      [3, 9, BLACK, KING],
      [4, 9, BLACK, ADVISOR],
      [3, 8, BLACK, ADVISOR],
    ]);
    assert.equal(isInCheck(board, BLACK), false);
    const legal = getLegalMoves(board, BLACK);
    assert.equal(legal.length, 0, `不应有合法着法，实际: ${JSON.stringify(legal)}`);
    const end = outcomeAfterMove(board, BLACK, null);
    assert.equal(end.status, RESULT.RED_WIN);
    assert.equal(end.reason, REASON.STALEMATE);
  });
});

describe('完整走子流程', () => {
  it('开局走兵合法，走完轮到黑方', () => {
    const state = createGameState();
    const res = applyMove(state, { file: 4, rank: 3 }, { file: 4, rank: 4 }, RED);
    assert.equal(res.ok, true);
    assert.equal(res.state.turn, BLACK);
    assert.equal(res.state.board[4][4], 'rP');
    assert.equal(res.state.board[3][4], null);
    assert.equal(res.state.status, RESULT.PLAYING);
  });

  it('服务端拒绝不合法着法', () => {
    const state = createGameState();
    const res = applyMove(state, { file: 4, rank: 3 }, { file: 4, rank: 5 }, RED);
    assert.equal(res.ok, false);
    assert.match(res.error, /规则/);
  });

  it('不能走对方的棋', () => {
    const state = createGameState();
    const res = applyMove(state, { file: 4, rank: 6 }, { file: 4, rank: 5 }, RED);
    assert.equal(res.ok, false);
  });
});

describe('长将简化规则', () => {
  it('同一将军局面第三次出现被禁止', () => {
    // 中兵挡住飞将；红车走到黑将底线将军。该局面若已出现两次则禁止再走。
    const after = place([
      [4, 0, RED, KING],
      [4, 3, RED, PAWN],
      [0, 9, RED, CHARIOT],
      [4, 9, BLACK, KING],
    ]);
    const before = place([
      [4, 0, RED, KING],
      [4, 3, RED, PAWN],
      [0, 7, RED, CHARIOT],
      [4, 9, BLACK, KING],
    ]);
    const afterKey = positionKey(after, BLACK);
    const counts = new Map([[afterKey, 2]]);
    const legal = legalDestSet(before, 0, 7, RED, counts);
    assert.equal(legal.has('0,9'), false);
    const unrestricted = legalDestSet(before, 0, 7, RED, null);
    assert.equal(unrestricted.has('0,9'), true);
    assert.equal(isInCheck(after, BLACK), true);
  });
});
