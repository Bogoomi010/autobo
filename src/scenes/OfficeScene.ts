import Phaser from "phaser";
import { GAME_H, GAME_W } from "../game/config";
import { bus, EV } from "../game/events";
import { store } from "../game/state";
import type { ClosedTrade, Payout } from "../game/types";
import { sfx } from "../core/sfx";
import { BotFloor } from "./botFloor";

const WORLD_TOP = 64; // 상단 DOM HUD 영역
const CHAR_SCALE = 2;
const SPEED = 160;
const INTERACT_RANGE = 60;
// 걷기 애니메이션 [0,1,0,2] @ 8fps = 0.5초 주기, 발이 땅에 닿는 프레임(0)이 주기당 2번(0.25초 간격)
const STEP_INTERVAL_MS = 250;

// 방 인테리어 경계 (벽 32px)
const SAFE_X0 = 32;
const SAFE_X1 = 416;
const LOBBY_X0 = 448;
const LOBBY_X1 = 832;
const INV_X0 = 864;
const INV_X1 = 1248;
const ROOM_Y0 = 96;
const ROOM_Y1 = 688;
const DOOR_Y0 = 320;
const DOOR_Y1 = 432;

// 금고실(작은 방) — 로비 우측 상단 구석, 트레이딩 시세판 오른쪽에 벽으로 구분해 배치.
// 위쪽·오른쪽은 건물 외벽/로비-투자방 칸막이를 그대로 재사용하고, 왼쪽·아래쪽만 새로 벽을 세운다.
const SAFE2_X0 = 712;
const SAFE2_X1 = LOBBY_X1; // 832 — 로비-투자방 칸막이를 그대로 오른쪽 벽으로 재사용
const SAFE2_Y0 = ROOM_Y0; // 96 — 건물 상단 외벽을 그대로 위쪽 벽으로 재사용
const SAFE2_Y1 = 224;
const SAFE2_DOOR_Y0 = 160; // 왼쪽 벽 아래쪽을 출입구로 비워둔다
const SAFE2_DOOR_Y1 = SAFE2_Y1;

type Nearest =
  | { type: "safe" | "terminal" | "board" | "money"; id?: string; ax: number; ay: number }
  | null;

/**
 * [에이전트 B] 탑다운 사무실 월드.
 * 금고방 / 로비 / 투자방, WASD·방향키 이동, Space 상호작용.
 */
export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;

  private mode: "play" | "modal" = "play";
  private facing: "down" | "up" | "side" = "down";
  private flip = false;

  private solids: Phaser.GameObjects.GameObject[] = [];
  private interactables: { type: "safe" | "terminal" | "board"; ax: number; ay: number }[] = [];
  private floorMoney = new Map<
    string,
    { sprite: Phaser.GameObjects.Image; bob: Phaser.Tweens.Tween }
  >();
  private carryMoney: Phaser.GameObjects.Image[] = [];
  private slotN = 0;

  private bubble!: Phaser.GameObjects.Container;
  private nearest: Nearest = null;
  private lastStepTime = 0;
  private botFloor!: BotFloor;

  // 정산기 배출구 월드 좌표
  private readonly dispenseX = 1140;
  private readonly dispenseY = 486;

  private onTradeClosed!: (trade: ClosedTrade, payout: Payout) => void;
  private onModalClosed!: (invested: boolean) => void;
  private onWithdrawModalClosed!: () => void;
  private onTradingBoardClosed!: () => void;
  private onBotDetailOpened!: () => void;
  private onBotDetailClosed!: () => void;

  constructor() {
    super("Office");
  }

  create(): void {
    this.buildFloors();
    this.buildWalls();
    this.buildFurniture();
    this.buildLabels();
    this.buildPlayer();
    this.buildUi();
    this.botFloor = new BotFloor(this);

    this.physics.world.setBounds(0, WORLD_TOP, GAME_W, GAME_H - WORLD_TOP);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.solids);

    this.cameras.main.setBounds(0, 0, GAME_W, GAME_H);

    // 입력
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // 복원: 세이브에 남은 돈뭉치를 정산기 앞에 스폰
    for (const p of store.payouts) {
      const { tx, ty } = this.nextSlot();
      const m = this.add.image(tx, ty, "money").setScale(CHAR_SCALE);
      this.registerFloorMoney(p.id, m, tx, ty);
    }

    // bus 리스너
    this.onTradeClosed = (trade, payout) => this.dispensePayout(payout, trade.pnlRate);
    this.onModalClosed = (invested) => {
      this.mode = "play";
      if (invested) sfx.power();
    };
    this.onWithdrawModalClosed = () => {
      this.mode = "play";
    };
    this.onTradingBoardClosed = () => {
      this.mode = "play";
    };
    // 매수봇 로봇 클릭(botFloor.ts) → 상세 패널이 뜨는 동안 이동/상호작용을 막는다
    this.onBotDetailOpened = () => {
      this.mode = "modal";
      this.player.setVelocity(0, 0);
      this.bubble.setVisible(false);
    };
    this.onBotDetailClosed = () => {
      this.mode = "play";
    };
    bus.on(EV.TRADE_CLOSED, this.onTradeClosed);
    bus.on(EV.COIN_MODAL_CLOSED, this.onModalClosed);
    bus.on(EV.WITHDRAW_MODAL_CLOSED, this.onWithdrawModalClosed);
    bus.on(EV.TRADING_BOARD_CLOSED, this.onTradingBoardClosed);
    bus.on(EV.OPEN_BOT_DETAIL, this.onBotDetailOpened);
    bus.on(EV.BOT_DETAIL_CLOSED, this.onBotDetailClosed);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(EV.TRADE_CLOSED, this.onTradeClosed);
      bus.off(EV.COIN_MODAL_CLOSED, this.onModalClosed);
      bus.off(EV.WITHDRAW_MODAL_CLOSED, this.onWithdrawModalClosed);
      bus.off(EV.TRADING_BOARD_CLOSED, this.onTradingBoardClosed);
      bus.off(EV.OPEN_BOT_DETAIL, this.onBotDetailOpened);
      bus.off(EV.BOT_DETAIL_CLOSED, this.onBotDetailClosed);
      this.botFloor.destroy();
    });
  }

  // ── 월드 빌드 ────────────────────────────────────
  private buildFloors(): void {
    const h = ROOM_Y1 - ROOM_Y0;
    // 매수봇 공간 — 로봇 팔레트(스틸 그레이)와 안 겹치도록 어두운 전용 타일을 쓴다
    this.add.tileSprite(SAFE_X0, ROOM_Y0, SAFE_X1 - SAFE_X0, h, "floor_bot").setOrigin(0, 0).setDepth(0);
    this.add.tileSprite(LOBBY_X0, ROOM_Y0, LOBBY_X1 - LOBBY_X0, h, "floor_wood").setOrigin(0, 0).setDepth(0);
    this.add.tileSprite(INV_X0, ROOM_Y0, INV_X1 - INV_X0, h, "floor_carpet").setOrigin(0, 0).setDepth(0);
    // 금고실(작은 방) 바닥 — 로비 바닥 위에 겹쳐 그려 방 구획을 시각적으로 분리한다
    this.add
      .tileSprite(SAFE2_X0, SAFE2_Y0, SAFE2_X1 - SAFE2_X0, SAFE2_Y1 - SAFE2_Y0, "floor_steel")
      .setOrigin(0, 0)
      .setDepth(0);
    // 문 개구부 러그
    this.add.tileSprite(SAFE_X1, DOOR_Y0, 32, DOOR_Y1 - DOOR_Y0, "door_rug").setOrigin(0, 0).setDepth(1);
    this.add.tileSprite(LOBBY_X1, DOOR_Y0, 32, DOOR_Y1 - DOOR_Y0, "door_rug").setOrigin(0, 0).setDepth(1);
    this.add
      .tileSprite(SAFE2_X0, SAFE2_DOOR_Y0, 32, SAFE2_DOOR_Y1 - SAFE2_DOOR_Y0, "door_rug")
      .setOrigin(0, 0)
      .setDepth(1);
  }

  private addWall(x: number, y: number, w: number, h: number): void {
    const t = this.add.tileSprite(x, y, w, h, "wall").setOrigin(0, 0).setDepth(y);
    this.physics.add.existing(t, true);
    (t.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    this.solids.push(t);
  }

  private buildWalls(): void {
    // 외곽
    this.addWall(0, WORLD_TOP, GAME_W, 32); // 상단
    this.addWall(0, ROOM_Y1, GAME_W, 32); // 하단
    this.addWall(0, WORLD_TOP, 32, GAME_H - WORLD_TOP); // 좌
    this.addWall(GAME_W - 32, WORLD_TOP, 32, GAME_H - WORLD_TOP); // 우
    // 칸막이 (문 개구부 제외)
    for (const dx of [SAFE_X1, LOBBY_X1]) {
      this.addWall(dx, ROOM_Y0, 32, DOOR_Y0 - ROOM_Y0);
      this.addWall(dx, DOOR_Y1, 32, ROOM_Y1 - DOOR_Y1);
    }
    // 금고실(작은 방) 칸막이 — 왼쪽 벽 위쪽(출입구 위)과 아래쪽 벽만 새로 세운다
    this.addWall(SAFE2_X0, SAFE2_Y0, 32, SAFE2_DOOR_Y0 - SAFE2_Y0);
    this.addWall(SAFE2_X0, SAFE2_Y1, SAFE2_X1 - SAFE2_X0, 32);
  }

  /** 보이지 않는 충돌 박스 (가구 하단 발치) */
  private addSolid(cx: number, cy: number, w: number, h: number): void {
    const r = this.add.rectangle(cx, cy, w, h, 0x000000, 0);
    this.physics.add.existing(r, true);
    this.solids.push(r);
  }

  private buildFurniture(): void {
    // 금고 — 거실 트레이딩 시세판 오른쪽, 새로 낸 작은 금고실 안에 배치 (왼쪽 방은 추후 매수봇 작업 공간으로 리모델링 예정)
    const SAFE_SCALE = CHAR_SCALE * 0.6;
    this.add.image(785, 150, "safe").setScale(SAFE_SCALE).setDepth(186);
    this.addSolid(785, 150, 35, 37);
    this.interactables.push({ type: "safe", ax: 785, ay: 200 });

    // 코인 단말기 (투자방)
    this.add.image(990, 250, "terminal").setDepth(276);
    this.addSolid(990, 254, 58, 36);
    this.interactables.push({ type: "terminal", ax: 990, ay: 300 });

    // 정산기 (투자방) — Space 상호작용 없음, 돈뭉치만 배출
    this.add.image(this.dispenseX, 460, "settle").setDepth(496);
    this.addSolid(this.dispenseX, 458, 44, 60);

    // 트레이딩 시세판 (거실 중앙 상단) — 돈 없이도 코인 목록 열람
    this.add.image(640, 130, "board").setDepth(130);
    this.interactables.push({ type: "board", ax: 640, ay: 186 });

    // 로비 소품
    this.add.image(640, 440, "rug").setScale(CHAR_SCALE).setDepth(1);
    this.add.image(560, 180, "desk").setDepth(192);
    this.addSolid(560, 184, 38, 16);
    this.add.image(560, 224, "chair").setDepth(235);
    this.add.image(520, 112, "clock").setScale(CHAR_SCALE).setDepth(160);

    // 화분 (아기자기, 충돌 없음)
    for (const [x, y] of [
      [470, 150],
      [742, 640],
      [900, 150],
      [1210, 640],
      [90, 640],
    ] as const) {
      this.add.image(x, y, "plant").setScale(CHAR_SCALE).setDepth(y + 30);
    }
  }

  private buildLabels(): void {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      // 순수 "monospace"만 쓰면 한글 글리프가 없는 폰트로 매칭돼 깨져 보일 수 있어 한글 폰트를 명시한다
      fontFamily: '"Malgun Gothic", monospace',
      fontSize: "16px",
      fontStyle: "bold",
      color: "#3d2a1a",
    };
    const label = (x: number, y: number, txt: string): void => {
      this.add.text(x, y, txt, style).setOrigin(0.5).setAlpha(0.5).setDepth(1);
    };
    label(224, 655, "🤖 매수봇 공간");
    label(640, 668, "🏢 로비");
    label(1056, 655, "📈 투자방");
    label(785, 210, "🔐 금고");
  }

  private buildPlayer(): void {
    this.player = this.physics.add.sprite(640, 400, "char_down_0").setScale(CHAR_SCALE);
    // 발치 히트박스 (native 좌표 기준)
    this.player.body!.setSize(10, 8);
    (this.player.body as Phaser.Physics.Arcade.Body).setOffset(3, 15);
  }

  private buildUi(): void {
    // Space 말풍선
    const bg = this.add.image(0, 0, "bubble").setScale(CHAR_SCALE);
    const bt = this.add
      .text(0, -6, "Space", { fontFamily: "monospace", fontSize: "11px", fontStyle: "bold", color: "#3d2a1a" })
      .setOrigin(0.5);
    this.bubble = this.add.container(0, 0, [bg, bt]).setDepth(20000).setVisible(false);

    // 머리 위 돈뭉치 (최대 3개)
    for (let i = 0; i < 3; i++) {
      this.carryMoney.push(this.add.image(0, 0, "money").setScale(CHAR_SCALE).setVisible(false));
    }
  }

  // ── 매 프레임 ────────────────────────────────────
  update(time: number): void {
    this.updateCarryMoney(time);

    if (this.mode === "play") {
      this.handleMovement(time);
      this.updateNearest();
      if (Phaser.Input.Keyboard.JustDown(this.keySpace)) this.doSpace();
    } else {
      this.player.setVelocity(0, 0);
      this.applyPose(false, time);
      this.bubble.setVisible(false);
      this.nearest = null;
    }

    this.player.setDepth(this.player.y + 20);
  }

  private handleMovement(time: number): void {
    let vx = 0;
    let vy = 0;
    const L = this.keyA.isDown || this.cursors.left.isDown;
    const R = this.keyD.isDown || this.cursors.right.isDown;
    const U = this.keyW.isDown || this.cursors.up.isDown;
    const D = this.keyS.isDown || this.cursors.down.isDown;
    if (L) vx = -1;
    else if (R) vx = 1;
    if (U) vy = -1;
    else if (D) vy = 1;

    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const len = Math.hypot(vx, vy);
      this.player.setVelocity((vx / len) * SPEED, (vy / len) * SPEED);
      if (vx !== 0) {
        this.facing = "side";
        this.flip = vx < 0;
      } else if (vy < 0) this.facing = "up";
      else this.facing = "down";
      if (time - this.lastStepTime >= STEP_INTERVAL_MS) {
        this.lastStepTime = time;
        sfx.step();
      }
    } else {
      this.player.setVelocity(0, 0);
    }
    this.applyPose(moving, time);
  }

  private applyPose(moving: boolean, time: number): void {
    const carried = store.carried > 0;
    this.player.setFlipX(this.facing === "side" && this.flip);

    if (carried) {
      this.player.anims.stop();
      this.player.setTexture(`char_carry_${this.facing}`);
    } else if (moving) {
      this.player.anims.play(`walk-${this.facing}`, true);
    } else {
      this.player.anims.stop();
      this.player.setTexture(`char_${this.facing}_0`);
    }
    // 미묘한 바운스 (걷거나 돈 들고 이동 중일 때)
    this.player.scaleY = CHAR_SCALE * (moving ? 1 + Math.sin(time * 0.02) * 0.03 : 1);
  }

  private updateCarryMoney(time: number): void {
    const carried = store.carried;
    const count = carried > 0 ? Phaser.Math.Clamp(Math.ceil(carried / 500_000), 1, 3) : 0;
    for (let i = 0; i < 3; i++) {
      const s = this.carryMoney[i];
      if (i < count) {
        const bob = Math.sin(time * 0.006 + i) * 3;
        s.setVisible(true)
          .setPosition(this.player.x + (i - (count - 1) / 2) * 4, this.player.y - 34 - i * 9 + bob)
          .setDepth(this.player.y + 200);
      } else {
        s.setVisible(false);
      }
    }
  }

  // ── 상호작용 ─────────────────────────────────────
  private updateNearest(): void {
    const px = this.player.x;
    const py = this.player.y;
    let nearest: Nearest = null;
    let nd = INTERACT_RANGE;

    for (const it of this.interactables) {
      const d = Phaser.Math.Distance.Between(px, py, it.ax, it.ay);
      if (d < nd) {
        nd = d;
        nearest = { type: it.type, ax: it.ax, ay: it.ay };
      }
    }
    for (const [id, m] of this.floorMoney) {
      const d = Phaser.Math.Distance.Between(px, py, m.sprite.x, m.sprite.y);
      if (d < nd) {
        nd = d;
        nearest = { type: "money", id, ax: m.sprite.x, ay: m.sprite.y - 14 };
      }
    }

    this.nearest = nearest;
    if (nearest) {
      this.bubble.setVisible(true).setPosition(nearest.ax, nearest.ay - 44);
    } else {
      this.bubble.setVisible(false);
    }
  }

  private doSpace(): void {
    const n = this.nearest;
    if (!n) return;

    if (n.type === "safe") {
      if (store.carried > 0) {
        store.deposit();
        sfx.kill();
        bus.emit(EV.TOAST, "금고에 입금했어요!", "good");
      } else {
        sfx.select();
        bus.emit(EV.OPEN_WITHDRAW_MODAL);
        this.mode = "modal";
        this.player.setVelocity(0, 0);
        this.bubble.setVisible(false);
      }
    } else if (n.type === "terminal") {
      if (store.carried > 0) {
        sfx.select();
        bus.emit(EV.OPEN_COIN_MODAL);
        this.mode = "modal";
        this.player.setVelocity(0, 0);
        this.bubble.setVisible(false);
      } else {
        sfx.denied();
        bus.emit(EV.TOAST, "금고에서 돈을 꺼내오세요!", "bad");
      }
    } else if (n.type === "board") {
      // 트레이딩 시세판 — 업비트 실사이트 스타일 차트/시세 대시보드 (돈 없이도 언제든 열람)
      sfx.select();
      bus.emit(EV.OPEN_TRADING_BOARD);
      this.mode = "modal";
      this.player.setVelocity(0, 0);
      this.bubble.setVisible(false);
    } else if (n.type === "money" && n.id) {
      if (store.pickUpPayout(n.id)) {
        sfx.card();
        this.removeFloorMoney(n.id);
      }
    }
  }

  // ── 정산기 배출 / 바닥 돈뭉치 ─────────────────────
  private nextSlot(): { tx: number; ty: number } {
    const n = this.slotN++;
    const tx = 1095 + (n % 4) * 34 + Phaser.Math.Between(-5, 5);
    const ty = 545 + Math.floor((n % 12) / 4) * 30 + Phaser.Math.Between(-4, 4);
    return { tx: Phaser.Math.Clamp(tx, INV_X0 + 20, INV_X1 - 20), ty: Phaser.Math.Clamp(ty, 530, ROOM_Y1 - 20) };
  }

  private dispensePayout(payout: Payout, pnlRate: number): void {
    // 익절/손절/수동 매도 모두 실제 손익 부호로 승패를 가른다(수동 매도도 이득이면 승리 연출)
    const isWin = pnlRate >= 0;
    const sx = this.dispenseX;
    const sy = this.dispenseY;
    const { tx, ty } = this.nextSlot();

    const m = this.add.image(sx, sy, "money").setScale(CHAR_SCALE).setDepth(sy);
    // 포물선으로 배출구에서 통 튀어나오기
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 650,
      ease: "Quad.easeOut",
      onUpdate: (tw) => {
        const p = tw.getValue() ?? 0;
        m.x = Phaser.Math.Linear(sx, tx, p);
        m.y = Phaser.Math.Linear(sy, ty, p) - Math.sin(p * Math.PI) * 80;
        m.setDepth(m.y);
      },
      onComplete: () => {
        m.setPosition(tx, ty).setDepth(ty);
        // 착지 바운스
        this.tweens.add({
          targets: m,
          y: ty - 4,
          duration: 130,
          yoyo: true,
          ease: "Sine.easeOut",
          onComplete: () => this.registerFloorMoney(payout.id, m, tx, ty),
        });
      },
    });

    if (isWin) {
      sfx.win();
      this.sparkle(tx, ty);
    } else {
      sfx.lose();
    }
  }

  private sparkle(x: number, y: number): void {
    const em = this.add.particles(x, y, "spark", {
      speed: { min: 40, max: 150 },
      angle: { min: 200, max: 340 },
      lifespan: 600,
      scale: { start: 2, end: 0 },
      gravityY: 220,
      quantity: 14,
      emitting: false,
    });
    em.setDepth(19000);
    em.explode(14);
    this.time.delayedCall(700, () => em.destroy());
  }

  private registerFloorMoney(id: string, sprite: Phaser.GameObjects.Image, x: number, y: number): void {
    sprite.setPosition(x, y).setDepth(y);
    const bob = this.tweens.add({
      targets: sprite,
      y: y - 3,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.floorMoney.set(id, { sprite, bob });
  }

  private removeFloorMoney(id: string): void {
    const f = this.floorMoney.get(id);
    if (!f) return;
    f.bob.stop();
    f.sprite.destroy();
    this.floorMoney.delete(id);
  }
}
