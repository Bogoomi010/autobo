import Phaser from "phaser";
import { GAME_H, GAME_W, MONEY_UNIT } from "../game/config";
import { bus, EV } from "../game/events";
import { store } from "../game/state";
import type { ClosedTrade, Payout } from "../game/types";
import { sfx } from "../core/sfx";

const WORLD_TOP = 64; // 상단 DOM HUD 영역
const CHAR_SCALE = 2;
const SPEED = 160;
const INTERACT_RANGE = 60;

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

type Nearest =
  | { type: "safe" | "terminal" | "money"; id?: string; ax: number; ay: number }
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
  private keyEsc!: Phaser.Input.Keyboard.Key;

  private mode: "play" | "selector" | "modal" = "play";
  private facing: "down" | "up" | "side" = "down";
  private flip = false;

  private solids: Phaser.GameObjects.GameObject[] = [];
  private interactables: { type: "safe" | "terminal"; ax: number; ay: number }[] = [];
  private floorMoney = new Map<
    string,
    { sprite: Phaser.GameObjects.Image; bob: Phaser.Tweens.Tween }
  >();
  private carryMoney: Phaser.GameObjects.Image[] = [];
  private slotN = 0;

  private bubble!: Phaser.GameObjects.Container;
  private sel!: Phaser.GameObjects.Container;
  private selText!: Phaser.GameObjects.Text;
  private selMan = 1;
  private selMax = 1;
  private nearest: Nearest = null;

  // 정산기 배출구 월드 좌표
  private readonly dispenseX = 1140;
  private readonly dispenseY = 486;

  private onTradeClosed!: (trade: ClosedTrade, payout: Payout) => void;
  private onModalClosed!: (invested: boolean) => void;

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
    this.keyEsc = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // 복원: 세이브에 남은 돈뭉치를 정산기 앞에 스폰
    for (const p of store.payouts) {
      const { tx, ty } = this.nextSlot();
      const m = this.add.image(tx, ty, "money").setScale(CHAR_SCALE);
      this.registerFloorMoney(p.id, m, tx, ty);
    }

    // bus 리스너
    this.onTradeClosed = (_trade, payout) => this.dispensePayout(payout);
    this.onModalClosed = (invested) => {
      this.mode = "play";
      if (invested) sfx.power();
    };
    bus.on(EV.TRADE_CLOSED, this.onTradeClosed);
    bus.on(EV.COIN_MODAL_CLOSED, this.onModalClosed);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(EV.TRADE_CLOSED, this.onTradeClosed);
      bus.off(EV.COIN_MODAL_CLOSED, this.onModalClosed);
    });
  }

  // ── 월드 빌드 ────────────────────────────────────
  private buildFloors(): void {
    const h = ROOM_Y1 - ROOM_Y0;
    this.add.tileSprite(SAFE_X0, ROOM_Y0, SAFE_X1 - SAFE_X0, h, "floor_steel").setOrigin(0, 0).setDepth(0);
    this.add.tileSprite(LOBBY_X0, ROOM_Y0, LOBBY_X1 - LOBBY_X0, h, "floor_wood").setOrigin(0, 0).setDepth(0);
    this.add.tileSprite(INV_X0, ROOM_Y0, INV_X1 - INV_X0, h, "floor_carpet").setOrigin(0, 0).setDepth(0);
    // 문 개구부 러그
    this.add.tileSprite(SAFE_X1, DOOR_Y0, 32, DOOR_Y1 - DOOR_Y0, "door_rug").setOrigin(0, 0).setDepth(1);
    this.add.tileSprite(LOBBY_X1, DOOR_Y0, 32, DOOR_Y1 - DOOR_Y0, "door_rug").setOrigin(0, 0).setDepth(1);
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
  }

  /** 보이지 않는 충돌 박스 (가구 하단 발치) */
  private addSolid(cx: number, cy: number, w: number, h: number): void {
    const r = this.add.rectangle(cx, cy, w, h, 0x000000, 0);
    this.physics.add.existing(r, true);
    this.solids.push(r);
  }

  private buildFurniture(): void {
    // 금고 (금고방)
    this.add.image(224, 268, "safe").setDepth(304);
    this.addSolid(224, 268, 58, 62);
    this.interactables.push({ type: "safe", ax: 224, ay: 322 });

    // 코인 단말기 (투자방)
    this.add.image(990, 250, "terminal").setDepth(276);
    this.addSolid(990, 254, 58, 36);
    this.interactables.push({ type: "terminal", ax: 990, ay: 300 });

    // 정산기 (투자방) — Space 상호작용 없음, 돈뭉치만 배출
    this.add.image(this.dispenseX, 460, "settle").setDepth(496);
    this.addSolid(this.dispenseX, 458, 44, 60);

    // 로비 소품
    this.add.image(640, 440, "rug").setScale(CHAR_SCALE).setDepth(1);
    this.add.image(560, 180, "desk").setDepth(192);
    this.addSolid(560, 184, 38, 16);
    this.add.image(560, 224, "chair").setDepth(235);
    this.add.image(640, 108, "clock").setScale(CHAR_SCALE).setDepth(160);

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
      fontFamily: "monospace",
      fontSize: "16px",
      fontStyle: "bold",
      color: "#3d2a1a",
    };
    const label = (x: number, y: number, txt: string): void => {
      this.add.text(x, y, txt, style).setOrigin(0.5).setAlpha(0.5).setDepth(1);
    };
    label(224, 655, "🔐 금고방");
    label(640, 668, "🏢 로비");
    label(1056, 655, "📈 투자방");
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

    // 출금 셀렉터
    const sbg = this.add.rectangle(0, 0, 150, 40, 0xf2e3c2).setStrokeStyle(3, 0x3d2a1a);
    const la = this.add
      .text(-58, -1, "◀", { fontFamily: "monospace", fontSize: "20px", fontStyle: "bold", color: "#f28f7a" })
      .setOrigin(0.5);
    const ra = this.add
      .text(58, -1, "▶", { fontFamily: "monospace", fontSize: "20px", fontStyle: "bold", color: "#f28f7a" })
      .setOrigin(0.5);
    this.selText = this.add
      .text(0, -1, "₩1만", { fontFamily: "monospace", fontSize: "18px", fontStyle: "bold", color: "#3d2a1a" })
      .setOrigin(0.5);
    this.sel = this.add.container(0, 0, [sbg, la, ra, this.selText]).setDepth(20001).setVisible(false);

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
      if (this.mode === "selector") {
        this.handleSelector();
        this.sel.setPosition(this.player.x, this.player.y - 58);
      }
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
        this.openSelector();
      }
    } else if (n.type === "terminal") {
      if (store.carried > 0) {
        bus.emit(EV.OPEN_COIN_MODAL);
        this.mode = "modal";
        this.player.setVelocity(0, 0);
        this.bubble.setVisible(false);
      } else {
        bus.emit(EV.TOAST, "금고에서 돈을 꺼내오세요!", "bad");
      }
    } else if (n.type === "money" && n.id) {
      if (store.pickUpPayout(n.id)) {
        sfx.card();
        this.removeFloorMoney(n.id);
      }
    }
  }

  // ── 출금 셀렉터 ──────────────────────────────────
  private openSelector(): void {
    const maxMan = Math.floor(store.vaultBalance() / MONEY_UNIT);
    if (maxMan < 1) {
      bus.emit(EV.TOAST, "금고가 비었어요…", "bad");
      return;
    }
    this.selMax = maxMan;
    this.selMan = Math.min(10, maxMan);
    this.mode = "selector";
    this.player.setVelocity(0, 0);
    this.sel.setVisible(true).setPosition(this.player.x, this.player.y - 58);
    this.updateSelText();
  }

  private handleSelector(): void {
    const clamp = (v: number): number => Phaser.Math.Clamp(v, 1, this.selMax);
    if (Phaser.Input.Keyboard.JustDown(this.keyA) || Phaser.Input.Keyboard.JustDown(this.cursors.left))
      this.selMan = clamp(this.selMan - 1);
    if (Phaser.Input.Keyboard.JustDown(this.keyD) || Phaser.Input.Keyboard.JustDown(this.cursors.right))
      this.selMan = clamp(this.selMan + 1);
    if (Phaser.Input.Keyboard.JustDown(this.keyW) || Phaser.Input.Keyboard.JustDown(this.cursors.up))
      this.selMan = clamp(this.selMan + 10);
    if (Phaser.Input.Keyboard.JustDown(this.keyS) || Phaser.Input.Keyboard.JustDown(this.cursors.down))
      this.selMan = clamp(this.selMan - 10);
    this.updateSelText();

    if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      store.withdraw(this.selMan * MONEY_UNIT);
      sfx.gacha();
      this.closeSelector();
    } else if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.closeSelector();
    }
  }

  private updateSelText(): void {
    this.selText.setText(`₩${this.selMan}만`);
  }

  private closeSelector(): void {
    this.sel.setVisible(false);
    this.mode = "play";
  }

  // ── 정산기 배출 / 바닥 돈뭉치 ─────────────────────
  private nextSlot(): { tx: number; ty: number } {
    const n = this.slotN++;
    const tx = 1095 + (n % 4) * 34 + Phaser.Math.Between(-5, 5);
    const ty = 545 + Math.floor((n % 12) / 4) * 30 + Phaser.Math.Between(-4, 4);
    return { tx: Phaser.Math.Clamp(tx, INV_X0 + 20, INV_X1 - 20), ty: Phaser.Math.Clamp(ty, 530, ROOM_Y1 - 20) };
  }

  private dispensePayout(payout: Payout): void {
    const isWin = payout.reason === "take-profit";
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
