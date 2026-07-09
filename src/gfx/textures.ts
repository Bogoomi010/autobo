import Phaser from "phaser";

/**
 * [에이전트 B] 절차적 픽셀 텍스처 (외부 에셋 없음).
 * 전부 Graphics → generateTexture 로 작게 그리고, 씬에서 정수 배율로 확대한다.
 * BootScene.create() 에서 1회 호출.
 */

// 팔레트 (GDD)
const CREAM = 0xf2e3c2;
const WOOD = 0x8a5a33;
const DARK = 0x3d2a1a;
const MINT = 0x7ed8c3;
const CORAL = 0xf28f7a;
const PAPER = 0xf5f5f0;
const GOLD = 0xf2c14e;

/** 픽셀 블록 하나 찍기 */
function px(g: Phaser.GameObjects.Graphics, c: number, x: number, y: number, w = 1, h = 1): void {
  g.fillStyle(c, 1);
  g.fillRect(x, y, w, h);
}

/** 텍스처 생성 헬퍼 (native 해상도로 그린 뒤 generateTexture) */
function tex(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void
): void {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** 캐릭터 프레임 한 장 (native 16×24). side=우향(좌향은 씬에서 flipX) */
function drawChar(
  g: Phaser.GameObjects.Graphics,
  dir: "down" | "up" | "side",
  frame: number,
  armsUp: boolean
): void {
  const SKIN = 0xf0c49a;
  const HAIR = 0x352617;
  const EYE = 0x2a1f14;
  const SUIT = 0x34506e;
  const SUITSH = 0x27405a;
  const SHIRT = 0xf2efe4;
  const TIE = CORAL;
  const PANTS = 0x2b3d51;
  const SHOE = 0x22190f;

  // 다리 (몸통보다 먼저 = 뒤)
  if (dir === "side") {
    let front = 8;
    let back = 6;
    if (frame === 1) {
      front = 9;
      back = 5;
    } else if (frame === 2) {
      front = 7;
      back = 7;
    }
    px(g, PANTS, back, 18, 3, 4);
    px(g, SHOE, back, 22, 3, 2);
    px(g, PANTS, front, 18, 3, 4);
    px(g, SHOE, front, 22, 3, 2);
  } else {
    let lLen = 4;
    let rLen = 4;
    if (frame === 1) rLen = 3; // 오른발 살짝 듦 → 바운스
    else if (frame === 2) lLen = 3;
    px(g, PANTS, 5, 18, 3, lLen);
    px(g, SHOE, 5, 18 + lLen, 3, 2);
    px(g, PANTS, 9, 18, 3, rLen);
    px(g, SHOE, 9, 18 + rLen, 3, 2);
  }

  // 몸통 (정장)
  if (dir === "side") {
    px(g, SUIT, 5, 10, 6, 8);
    px(g, SUITSH, 5, 10, 1, 8);
  } else {
    px(g, SUIT, 4, 10, 8, 8);
    px(g, SUITSH, 4, 10, 1, 8);
    px(g, SUITSH, 11, 10, 1, 8);
    if (dir === "down") {
      px(g, SHIRT, 7, 10, 2, 7);
      px(g, TIE, 7, 11, 2, 4);
    }
  }

  // 팔
  if (armsUp) {
    if (dir === "side") {
      px(g, SUIT, 7, 4, 3, 8);
      px(g, SKIN, 7, 3, 3, 2);
    } else {
      px(g, SUIT, 3, 4, 2, 8);
      px(g, SKIN, 3, 3, 2, 2);
      px(g, SUIT, 11, 4, 2, 8);
      px(g, SKIN, 11, 3, 2, 2);
    }
  } else {
    if (dir === "side") {
      px(g, SUIT, 7, 11, 2, 5);
      px(g, SKIN, 7, 16, 2, 1);
    } else {
      px(g, SUIT, 3, 11, 2, 5);
      px(g, SKIN, 3, 16, 2, 1);
      px(g, SUIT, 11, 11, 2, 5);
      px(g, SKIN, 11, 16, 2, 1);
    }
  }

  // 머리
  if (dir === "up") {
    px(g, HAIR, 4, 3, 8, 7); // 뒤통수
  } else if (dir === "side") {
    px(g, HAIR, 5, 3, 6, 3); // 윗머리
    px(g, HAIR, 5, 3, 3, 7); // 뒷머리
    px(g, SKIN, 8, 5, 3, 5); // 얼굴(앞)
    px(g, EYE, 10, 7, 1, 2);
  } else {
    px(g, HAIR, 4, 3, 8, 3); // 앞머리
    px(g, HAIR, 4, 3, 1, 6);
    px(g, HAIR, 11, 3, 1, 6);
    px(g, SKIN, 5, 5, 6, 5); // 얼굴
    px(g, EYE, 6, 7, 1, 2);
    px(g, EYE, 9, 7, 1, 2);
  }
}

/**
 * 매수봇 로봇 뒷모습(책상 앞에 앉아 일하는 중) — native 16×24로, 캐릭터 프레임과
 * 동일한 캔버스 크기/배율(CHAR_SCALE)을 써서 사용자 캐릭터와 같은 비율로 보이게 한다.
 * 앉은 자세라 다리는 그리지 않고(책상에 가려짐) 등판+머리+팔만 표현한다.
 */
function drawBotRobot(g: Phaser.GameObjects.Graphics): void {
  const STEEL = 0x9aa4af;
  const STEEL_DARK = 0x6b7178;
  const OUTLINE = 0x2b2f36;

  // 안테나
  px(g, OUTLINE, 7, 0, 1, 3);
  px(g, CORAL, 6, 0, 3, 2);

  // 머리(뒤통수) — 상단 민트 트림 + 가운데 이음선 + 옆 돌기
  px(g, STEEL, 4, 3, 8, 7);
  px(g, MINT, 4, 3, 8, 1);
  px(g, OUTLINE, 7, 4, 1, 6);
  px(g, STEEL_DARK, 3, 5, 1, 2);
  px(g, STEEL_DARK, 12, 5, 1, 2);

  // 몸통(등판) — 어깨 트림 + 팔 + 통풍구
  px(g, STEEL, 3, 10, 10, 9);
  px(g, STEEL_DARK, 3, 10, 1, 9);
  px(g, STEEL_DARK, 12, 10, 1, 9);
  px(g, MINT, 3, 10, 10, 1);
  px(g, STEEL, 2, 11, 1, 6); // 왼팔
  px(g, STEEL, 13, 11, 1, 6); // 오른팔
  px(g, OUTLINE, 6, 15, 1, 2);
  px(g, OUTLINE, 9, 15, 1, 2);

  // 책상/의자에 가려질 하체 — 살짝만 표현
  px(g, STEEL_DARK, 4, 19, 8, 3);
}

export function generateTextures(scene: Phaser.Scene): void {
  // ── 바닥 타일 (32×32) ──────────────────────────────
  // 로비: 우드 마루
  tex(scene, "floor_wood", 32, 32, (g) => {
    px(g, WOOD, 0, 0, 32, 32);
    for (const y of [0, 8, 16, 24]) px(g, 0x6e4527, 0, y, 32, 1);
    const seams = [
      [16, 0],
      [8, 8],
      [24, 8],
      [16, 16],
      [8, 24],
      [24, 24],
    ];
    for (const [x, y] of seams) px(g, 0x74492a, x, y, 1, 8);
    px(g, 0x9a6a3e, 3, 3, 5, 1);
    px(g, 0x9a6a3e, 19, 11, 5, 1);
    px(g, 0x9a6a3e, 11, 27, 5, 1);
  });
  // 금고방: 스틸 타일 (16px 체커)
  tex(scene, "floor_steel", 32, 32, (g) => {
    px(g, 0x8f97a1, 0, 0, 32, 32);
    px(g, 0x9aa4af, 0, 0, 16, 16);
    px(g, 0x9aa4af, 16, 16, 16, 16);
    px(g, 0x656d76, 15, 0, 2, 32);
    px(g, 0x656d76, 0, 15, 32, 2);
    px(g, 0xb4bcc4, 2, 2, 3, 1);
    px(g, 0xb4bcc4, 18, 18, 3, 1);
  });
  // 매수봇 공간: 다크 슬레이트 타일 — 로봇 팔레트(스틸 그레이)와 겹쳐 보이지 않는 어두운 톤 + 민트 회로 트레이스
  tex(scene, "floor_bot", 32, 32, (g) => {
    px(g, 0x2b2f3a, 0, 0, 32, 32);
    px(g, 0x333947, 0, 0, 16, 16);
    px(g, 0x333947, 16, 16, 16, 16);
    px(g, 0x1f2229, 15, 0, 2, 32);
    px(g, 0x1f2229, 0, 15, 32, 2);
    px(g, MINT, 2, 2, 6, 1);
    px(g, MINT, 2, 2, 1, 6);
    px(g, MINT, 18, 18, 6, 1);
    px(g, MINT, 23, 13, 1, 6);
    px(g, 0x454c5c, 8, 24, 3, 3);
    px(g, 0x454c5c, 22, 6, 3, 3);
  });
  // 투자방: 민트 카펫 (4px 위브)
  tex(scene, "floor_carpet", 32, 32, (g) => {
    for (let y = 0; y < 32; y += 4) {
      for (let x = 0; x < 32; x += 4) {
        const c = (x / 4 + y / 4) % 2 === 0 ? 0x62b3a1 : 0x56a493;
        px(g, c, x, y, 4, 4);
      }
    }
    px(g, 0x74c7b4, 8, 8, 2, 2);
    px(g, 0x74c7b4, 22, 20, 2, 2);
  });

  // ── 벽 (32×32, 상단면 하이라이트 = 윗면 느낌) ──────────
  tex(scene, "wall", 32, 32, (g) => {
    px(g, 0x5a3d24, 0, 0, 32, 32);
    px(g, 0x7a5636, 0, 0, 32, 4); // 윗면 하이라이트
    // 벽돌 mortar
    for (const y of [10, 20, 30]) px(g, DARK, 0, y, 32, 1);
    px(g, DARK, 16, 4, 1, 6);
    px(g, DARK, 8, 10, 1, 10);
    px(g, DARK, 24, 10, 1, 10);
    px(g, DARK, 16, 20, 1, 10);
    px(g, 0x4a3016, 0, 31, 32, 1);
  });

  // 문 개구부 러그
  tex(scene, "door_rug", 32, 32, (g) => {
    px(g, CREAM, 0, 0, 32, 32);
    px(g, CORAL, 0, 0, 32, 3);
    px(g, CORAL, 0, 29, 32, 3);
    px(g, MINT, 4, 4, 24, 24);
    px(g, CREAM, 13, 13, 6, 6);
  });

  // ── 금고 (native 64×72) ────────────────────────────
  tex(scene, "safe", 64, 72, (g) => {
    px(g, 0x2a2f36, 4, 6, 56, 64); // 외곽 다크
    px(g, 0x9aa3ad, 6, 8, 52, 60); // 스틸 페이스
    px(g, MINT, 6, 8, 52, 3); // 민트 트림
    px(g, 0x848d97, 12, 16, 40, 46); // 문 패널
    px(g, DARK, 12, 16, 40, 1);
    px(g, DARK, 12, 61, 40, 1);
    // 다이얼
    g.fillStyle(0x3a3f47, 1);
    g.fillCircle(32, 38, 10);
    g.fillStyle(0x6b7178, 1);
    g.fillCircle(32, 38, 6);
    g.fillStyle(MINT, 1);
    g.fillCircle(32, 34, 2);
    // 손잡이
    px(g, DARK, 44, 36, 8, 3);
    // 볼트
    for (const [x, y] of [
      [10, 12],
      [51, 12],
      [10, 63],
      [51, 63],
    ] as const)
      px(g, 0x565d65, x, y, 3, 3);
  });

  // ── 코인 단말기 (책상+모니터, native 64×52) ───────────
  tex(scene, "terminal", 64, 52, (g) => {
    px(g, WOOD, 4, 34, 56, 14); // 책상 상판
    px(g, 0x6e4527, 4, 44, 56, 4);
    px(g, DARK, 30, 30, 4, 6); // 스탠드
    px(g, 0x2b2f36, 12, 4, 40, 28); // 모니터 베젤
    px(g, MINT, 12, 4, 40, 2);
    px(g, 0x0f1620, 15, 7, 34, 20); // 스크린
    // 그리드
    px(g, 0x1d2836, 15, 17, 34, 1);
    // 캔들 (상승=빨강/하락=파랑)
    const bars: [number, number, number, number, number][] = [
      [18, 18, 3, 7, 0xe4553f],
      [24, 14, 3, 10, 0x4f83d6],
      [30, 20, 3, 5, 0xe4553f],
      [36, 11, 3, 12, 0xe4553f],
      [42, 16, 3, 8, 0x4f83d6],
    ];
    for (const [x, y, w, h, c] of bars) px(g, c, x, y, w, h);
  });

  // ── 트레이딩 시세판 (벽걸이 대형 보드, native 96×60) ──
  // 거실 중앙 상단. 돈 없이도 코인 목록을 훑어보는 상호작용 오브젝트.
  tex(scene, "board", 96, 60, (g) => {
    px(g, DARK, 0, 0, 96, 60); // 외곽 프레임
    px(g, 0x2b2f36, 3, 3, 90, 50); // 베젤
    px(g, MINT, 3, 3, 90, 3); // 민트 상단 트림
    px(g, 0x0f1620, 7, 9, 82, 42); // 스크린
    // 헤더 바 + 타이틀 + LIVE 램프
    px(g, 0x1d2836, 7, 9, 82, 7);
    px(g, MINT, 11, 11, 26, 3); // "시세판" 타이틀
    g.fillStyle(0x5fe0a0, 1);
    g.fillCircle(82, 12, 2); // LIVE 램프
    // 코인 행 4줄 (심볼칩 · 이름 · 가격 · 등락칩) — 업비트 관례 상승=빨강/하락=파랑
    const rows: [number, number][] = [
      [21, 0xe4553f],
      [29, 0x4f83d6],
      [37, 0xe4553f],
      [45, 0xe4553f],
    ];
    for (const [y, chg] of rows) {
      px(g, 0xf2c14e, 11, y, 4, 4); // 심볼 칩
      px(g, 0x6b7178, 18, y, 26, 2); // 이름
      px(g, 0x9aa4af, 52, y, 16, 2); // 가격
      px(g, chg, 74, y, 11, 4); // 등락 칩
    }
  });

  // ── 정산기 (ATM, native 48×72) ─────────────────────
  tex(scene, "settle", 48, 72, (g) => {
    px(g, DARK, 2, 2, 44, 68);
    px(g, 0xc3cad2, 4, 4, 40, 64); // 스틸 바디
    px(g, MINT, 4, 4, 40, 3);
    px(g, 0x0f1620, 9, 9, 30, 16); // 스크린
    px(g, MINT, 11, 12, 12, 2);
    px(g, MINT, 11, 17, 20, 2);
    // 키패드
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) px(g, 0x6b7178, 12 + c * 8, 30 + r * 6, 4, 4);
    // 배출구
    px(g, 0x1c2026, 8, 52, 32, 8);
    px(g, CORAL, 6, 60, 36, 4); // 배출 트레이 립
    px(g, 0xd96f5a, 6, 63, 36, 1);
  });

  // ── 소품 ──────────────────────────────────────────
  tex(scene, "desk", 40, 24, (g) => {
    px(g, WOOD, 2, 6, 36, 14);
    px(g, 0x9a6a3e, 2, 6, 36, 2);
    px(g, 0x6e4527, 2, 16, 36, 4);
    px(g, 0x5a3a22, 4, 20, 3, 4);
    px(g, 0x5a3a22, 33, 20, 3, 4);
    px(g, PAPER, 8, 8, 8, 6); // 서류
    px(g, CORAL, 27, 8, 4, 6); // 컵
  });

  tex(scene, "chair", 18, 22, (g) => {
    px(g, CORAL, 3, 3, 12, 9);
    px(g, 0xd96f5a, 3, 3, 12, 1);
    px(g, 0xf2a894, 4, 12, 10, 4);
    px(g, DARK, 8, 16, 2, 5);
    px(g, DARK, 4, 21, 10, 1);
  });

  tex(scene, "plant", 22, 30, (g) => {
    px(g, 0xc0704a, 5, 20, 12, 9); // 화분
    px(g, 0x9a5636, 5, 20, 12, 1);
    px(g, 0xd98a63, 5, 21, 12, 2);
    px(g, 0x4f9d5f, 7, 6, 8, 14); // 잎
    px(g, 0x3e864d, 5, 10, 4, 8);
    px(g, 0x3e864d, 13, 10, 4, 8);
    px(g, 0x6bbf78, 9, 3, 4, 10);
  });

  // ── 매수봇 성과 장식 (수익 낼수록 책상/로봇에 붙는다, botFloor.ts) ──
  tex(scene, "trophy", 12, 14, (g) => {
    px(g, GOLD, 2, 1, 8, 5); // 컵
    px(g, 0xd99a1f, 2, 1, 8, 1);
    px(g, GOLD, 1, 2, 1, 3); // 왼쪽 손잡이
    px(g, GOLD, 10, 2, 1, 3); // 오른쪽 손잡이
    px(g, 0xb9860f, 5, 6, 2, 3); // 기둥
    px(g, 0xb9860f, 3, 9, 6, 2); // 받침
  });
  tex(scene, "crown", 14, 9, (g) => {
    px(g, GOLD, 1, 4, 12, 4); // 띠
    px(g, GOLD, 1, 1, 2, 4); // 왼쪽 뿔
    px(g, GOLD, 6, 0, 2, 5); // 가운데 뿔(가장 높음)
    px(g, GOLD, 11, 1, 2, 4); // 오른쪽 뿔
    px(g, 0xe4553f, 6, 1, 2, 2); // 보석
  });

  tex(scene, "clock", 18, 18, (g) => {
    g.fillStyle(DARK, 1);
    g.fillCircle(9, 9, 9);
    g.fillStyle(CREAM, 1);
    g.fillCircle(9, 9, 7);
    px(g, DARK, 9, 4, 1, 5);
    px(g, DARK, 9, 9, 4, 1);
  });

  tex(scene, "rug", 48, 32, (g) => {
    px(g, CORAL, 0, 0, 48, 32);
    px(g, CREAM, 3, 3, 42, 26);
    px(g, MINT, 6, 6, 36, 20);
    px(g, CORAL, 21, 13, 6, 6);
  });

  // ── 돈뭉치 (native 18×12) ──────────────────────────
  tex(scene, "money", 18, 12, (g) => {
    px(g, 0x3f8f57, 0, 2, 18, 10); // 초록 아래 edge
    px(g, 0x5fbf6f, 0, 1, 18, 9); // 초록 페이스
    px(g, 0x74d081, 1, 1, 16, 2); // 하이라이트
    px(g, CREAM, 7, 0, 4, 12); // 띠지
    px(g, 0xd8b98a, 7, 0, 1, 12);
    px(g, 0x2a6b3a, 8, 4, 2, 4); // ₩ 느낌
  });

  // ── 반짝임 파티클 (6×6) ────────────────────────────
  tex(scene, "spark", 6, 6, (g) => {
    px(g, 0xffffff, 2, 0, 2, 6);
    px(g, 0xffffff, 0, 2, 6, 2);
    px(g, MINT, 2, 2, 2, 2);
  });

  // ── 말풍선 (native 40×20) ──────────────────────────
  tex(scene, "bubble", 40, 22, (g) => {
    px(g, DARK, 2, 0, 36, 16);
    px(g, CREAM, 4, 2, 32, 12);
    px(g, DARK, 17, 15, 6, 4); // 꼬리
    px(g, CREAM, 18, 15, 4, 2);
  });

  // ── 캐릭터 프레임 (native 16×24) ───────────────────
  for (let f = 0; f < 3; f++) {
    tex(scene, `char_down_${f}`, 16, 24, (g) => drawChar(g, "down", f, false));
    tex(scene, `char_up_${f}`, 16, 24, (g) => drawChar(g, "up", f, false));
    tex(scene, `char_side_${f}`, 16, 24, (g) => drawChar(g, "side", f, false));
  }
  tex(scene, "char_carry_down", 16, 24, (g) => drawChar(g, "down", 0, true));
  tex(scene, "char_carry_up", 16, 24, (g) => drawChar(g, "up", 0, true));
  tex(scene, "char_carry_side", 16, 24, (g) => drawChar(g, "side", 0, true));

  // ── 매수봇 로봇(뒷모습, native 16×24) + 상태 표시등(6×6) ──
  tex(scene, "bot_robot", 16, 24, drawBotRobot);
  tex(scene, "status_dot", 6, 6, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(3, 3, 3);
  });
}
