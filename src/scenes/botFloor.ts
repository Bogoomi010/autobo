/**
 * 왼쪽 방(매수봇 공간)에 매수봇 각각을 "책상 앞에 앉아 일하는 로봇"으로 그려주는 매니저.
 * EV.BOTS_CHANGED로 명단이 바뀔 때마다 3열 그리드로 재배치한다.
 * 로봇에 마우스를 올리면 botDock 카드와 같은 정보를 월드 툴팁으로 보여주고,
 * 클릭하면 EV.OPEN_BOT_DETAIL을 emit해 DOM 상세 패널(botDetailModal.ts)을 연다.
 * OfficeScene이 create()에서 생성하고 SHUTDOWN 시 destroy()를 호출해야 한다.
 */
import Phaser from "phaser";
import { botEngine } from "../bots/botEngine";
import {
  BOT_STATE_LABEL,
  botTier,
  botTypeIcon,
  formatBotFootLine,
  formatBotPnl,
  formatBotSettingsLine,
  isBotBusyState,
} from "../bots/botFormat";
import type { BotState, TradeBot } from "../bots/types";
import { sfx } from "../core/sfx";
import { bus, EV } from "../game/events";
import { krw } from "../game/format";
import { badgeColorHex } from "../ui/uiKit";

const CHAR_SCALE = 2; // OfficeScene.ts 캐릭터 배율과 동일 — 로봇이 사용자 캐릭터와 같은 비율로 보이게 한다

// 3열 그리드 배치 — 왼쪽 방(OfficeScene의 SAFE_X0=32~SAFE_X1=416, ROOM_Y0=96~ROOM_Y1=688) 안쪽 좌표
const COLS = 3;
const COL0_X = 120;
const COL_SPACING = 104;
const ROW0_Y = 170;
const ROW_SPACING = 120;
const ROBOT_Y_OFFSET = 34; // 책상 대비 로봇 y 오프셋(책상 앞에 앉은 것처럼)

// 월드 호버 툴팁 레이아웃 — 긴 설정/누적 줄은 word-wrap으로 감싸 절대 옆으로 흘러넘치지 않게 한다
const TIP_W = 232;
const TIP_PAD = 10;
const TIP_HEADER_H = 26;
const TIP_ICON = 18;
const TIP_CONTENT_W = TIP_W - TIP_PAD * 2;
const TIP_CREAM = 0xf7ecd4;
const TIP_HEADER_BAND = 0xefe0c0;
const TIP_INK = 0x3d2a1a;

// 순수 "monospace"만 쓰면 한글 글리프가 없는 폰트로 매칭돼 깨져 보일 수 있어 한글 폰트를 명시한다
const KO_FONT = '"Malgun Gothic", monospace';

const DARK = "#3d2a1a";
const MUTED = "#8a5a33";
const AMBER = "#b8860b";
const UP = "#e5484d"; // 업비트 관례: 상승=빨강
const DOWN = "#3b82f6"; // 업비트 관례: 하락=파랑

function slot(index: number): { x: number; y: number } {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return { x: COL0_X + col * COL_SPACING, y: ROW0_Y + row * ROW_SPACING };
}

/** 상태 표시등 색 — 보유 중엔 현재 손익 부호(업비트 관례: 상승=빨강/하락=파랑)를 그대로 반영 */
function lightColor(bot: TradeBot): number {
  const state: BotState = bot.state;
  switch (state) {
    case "idle":
      return 0xb0a488;
    case "scanning":
      return 0x2fbf9b;
    case "targeting":
    case "buying":
    case "selling":
      return 0xf2c14e;
    case "holding":
      return (bot.currentPnlRate ?? 0) >= 0 ? 0xe5484d : 0x3b82f6;
    case "sold_profit":
      return 0xe5484d;
    case "sold_loss":
      return 0x3b82f6;
    case "error":
      return 0xe5484d;
  }
}

interface BotRec {
  desk: Phaser.GameObjects.Image;
  robot: Phaser.GameObjects.Sprite;
  light: Phaser.GameObjects.Image;
  blinkTween: Phaser.Tweens.Tween | null;
  robotX: number;
  robotY: number;
  deskX: number;
  deskY: number;
  tier: number;
  // 성과 장식 — botTier(bot) 등급에 따라 붙고 떨어진다 (botFormat.ts의 botTier 참고)
  plant?: Phaser.GameObjects.Image;
  trophy?: Phaser.GameObjects.Image;
  crown?: Phaser.GameObjects.Image;
  auraTimer?: Phaser.Time.TimerEvent;
}

export class BotFloor {
  private recs = new Map<string, BotRec>();
  private latestBots: TradeBot[] = [];

  // 월드 호버 툴팁 파츠 (botDock 카드 정보를 재사용해 미니 카드 형태로 그린다)
  private tooltipContainer: Phaser.GameObjects.Container;
  private tooltipBg: Phaser.GameObjects.Graphics;
  private tooltipIconBg: Phaser.GameObjects.Rectangle;
  private tooltipIconText: Phaser.GameObjects.Text;
  private tooltipName: Phaser.GameObjects.Text;
  private tooltipState: Phaser.GameObjects.Text;
  private tooltipTier: Phaser.GameObjects.Text;
  private tooltipMarket: Phaser.GameObjects.Text;
  private tooltipPnl: Phaser.GameObjects.Text;
  private tooltipSettings: Phaser.GameObjects.Text;
  private tooltipFoot: Phaser.GameObjects.Text;

  private readonly onBotsChanged = (bots: TradeBot[]): void => this.render(bots);
  private readonly onBotProfitCredited = (botId: string, amountKrw: number): void => this.showProfitPopup(botId, amountKrw);

  constructor(private scene: Phaser.Scene) {
    this.tooltipBg = scene.add.graphics();

    this.tooltipIconBg = scene.add
      .rectangle(TIP_PAD + TIP_ICON / 2, TIP_HEADER_H / 2, TIP_ICON, TIP_ICON, 0xffffff)
      .setStrokeStyle(2, TIP_INK);
    this.tooltipIconText = scene.add
      .text(TIP_PAD + TIP_ICON / 2, TIP_HEADER_H / 2, "", { fontSize: "11px" })
      .setOrigin(0.5);
    this.tooltipName = scene.add
      .text(TIP_PAD + TIP_ICON + 6, TIP_HEADER_H / 2, "", {
        fontFamily: KO_FONT,
        fontSize: "12px",
        fontStyle: "bold",
        color: DARK,
      })
      .setOrigin(0, 0.5);
    this.tooltipState = scene.add
      .text(TIP_W - TIP_PAD, TIP_HEADER_H / 2, "", { fontFamily: KO_FONT, fontSize: "10px", fontStyle: "bold", color: DARK })
      .setOrigin(1, 0.5);
    this.tooltipTier = scene.add
      .text(TIP_PAD, TIP_HEADER_H + 4, "", { fontFamily: KO_FONT, fontSize: "10px", fontStyle: "bold", color: DARK })
      .setOrigin(0, 0);
    this.tooltipMarket = scene.add
      .text(TIP_PAD, 0, "", { fontFamily: KO_FONT, fontSize: "11px", color: DARK })
      .setOrigin(0, 0);
    this.tooltipPnl = scene.add
      .text(TIP_W - TIP_PAD, 0, "", { fontFamily: KO_FONT, fontSize: "13px", fontStyle: "bold", color: DARK })
      .setOrigin(1, 0);
    this.tooltipSettings = scene.add.text(TIP_PAD, 0, "", {
      fontFamily: KO_FONT,
      fontSize: "10px",
      color: MUTED,
      wordWrap: { width: TIP_CONTENT_W },
    });
    this.tooltipFoot = scene.add.text(TIP_PAD, 0, "", {
      fontFamily: KO_FONT,
      fontSize: "10px",
      color: MUTED,
      wordWrap: { width: TIP_CONTENT_W },
    });

    this.tooltipContainer = scene.add
      .container(0, 0, [
        this.tooltipBg,
        this.tooltipIconBg,
        this.tooltipIconText,
        this.tooltipName,
        this.tooltipState,
        this.tooltipTier,
        this.tooltipMarket,
        this.tooltipPnl,
        this.tooltipSettings,
        this.tooltipFoot,
      ])
      .setDepth(20000)
      .setVisible(false);

    this.render(botEngine.getBots());
    bus.on(EV.BOTS_CHANGED, this.onBotsChanged);
    bus.on(EV.BOT_PROFIT_CREDITED, this.onBotProfitCredited);
  }

  destroy(): void {
    bus.off(EV.BOTS_CHANGED, this.onBotsChanged);
    bus.off(EV.BOT_PROFIT_CREDITED, this.onBotProfitCredited);
    for (const rec of this.recs.values()) this.destroyRec(rec);
    this.recs.clear();
    this.tooltipContainer.destroy();
  }

  /**
   * 봇이 수익 매도해 금고에 바로 입금됐을 때(EV.BOT_PROFIT_CREDITED) — 정산기까지 돈뭉치가
   * 굴러가는 연출 대신, 그 봇 책상 위에 "+₩N" 획득 텍스트를 띄우고 바로 위로 사라지게 한다.
   */
  private showProfitPopup(botId: string, amountKrw: number): void {
    const rec = this.recs.get(botId);
    if (!rec) return;

    sfx.card();
    this.burstSparkle(rec);

    const label = this.scene.add
      .text(rec.robotX, rec.robotY - 30, `+${krw(amountKrw)}`, {
        fontFamily: KO_FONT,
        fontSize: "13px",
        fontStyle: "bold",
        color: "#2fbf9b",
        stroke: DARK,
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(20001);

    this.scene.tweens.add({
      targets: label,
      y: rec.robotY - 62,
      alpha: 0,
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  private render(bots: TradeBot[]): void {
    this.latestBots = bots;
    const seen = new Set<string>();
    bots.forEach((bot, i) => {
      seen.add(bot.id);
      let rec = this.recs.get(bot.id);
      if (!rec) {
        rec = this.createRec(bot, i);
        this.recs.set(bot.id, rec);
      }
      this.updateRec(rec, bot);
    });
    for (const [id, rec] of this.recs) {
      if (!seen.has(id)) {
        this.destroyRec(rec);
        this.recs.delete(id);
      }
    }
  }

  private createRec(bot: TradeBot, index: number): BotRec {
    const { x, y } = slot(index);
    const robotX = x;
    const robotY = y + ROBOT_Y_OFFSET;

    const desk = this.scene.add.image(x, y, "desk").setDepth(y + 12);
    const robot = this.scene.add
      .sprite(robotX, robotY, "bot_robot_0")
      .setScale(CHAR_SCALE)
      .setDepth(robotY)
      .setInteractive({ useHandCursor: true });
    robot.play("bot-working");
    const light = this.scene.add.image(robotX + 2, robotY - 36, "status_dot").setDepth(20000);

    robot.on("pointerover", () => {
      sfx.botHover();
      this.showTooltip(bot.id);
    });
    robot.on("pointerout", () => {
      sfx.botHoverOut();
      this.hideTooltip();
    });
    robot.on("pointerdown", () => {
      sfx.botClick();
      this.hideTooltip();
      bus.emit(EV.OPEN_BOT_DETAIL, bot.id);
    });

    return { desk, robot, light, blinkTween: null, robotX, robotY, deskX: x, deskY: y, tier: 0 };
  }

  private updateRec(rec: BotRec, bot: TradeBot): void {
    rec.light.setTint(lightColor(bot));

    const shouldBlink = isBotBusyState(bot.state);
    if (shouldBlink && !rec.blinkTween) {
      rec.blinkTween = this.scene.tweens.add({ targets: rec.light, alpha: 0.25, duration: 350, yoyo: true, repeat: -1 });
    } else if (!shouldBlink && rec.blinkTween) {
      rec.blinkTween.stop();
      rec.blinkTween = null;
      rec.light.setAlpha(1);
    }

    this.applyTierDecor(rec, bot);
  }

  /**
   * 수익을 낼수록 책상/로봇을 꾸며주는 성과 장식 — botTier(bot)를 매번 다시 계산해 등급에 맞춰 붙이고 뗀다.
   * 손실이 나서 등급이 내려가면 장식도 그대로 벗겨진다(실시간 손익을 그대로 반영).
   * Lv.1 화분 → Lv.2 +트로피 → Lv.3 +왕관 → Lv.4 +주기적 스파클(전설).
   */
  private applyTierDecor(rec: BotRec, bot: TradeBot): void {
    const level = botTier(bot).level;

    if (level >= 1 && !rec.plant) {
      rec.plant = this.scene.add.image(rec.deskX - 28, rec.deskY + 8, "plant").setScale(0.7).setDepth(rec.deskY + 13);
    } else if (level < 1 && rec.plant) {
      rec.plant.destroy();
      rec.plant = undefined;
    }

    if (level >= 2 && !rec.trophy) {
      rec.trophy = this.scene.add.image(rec.deskX + 15, rec.deskY - 8, "trophy").setDepth(rec.deskY + 14);
    } else if (level < 2 && rec.trophy) {
      rec.trophy.destroy();
      rec.trophy = undefined;
    }

    if (level >= 3 && !rec.crown) {
      rec.crown = this.scene.add.image(rec.robotX - 3, rec.robotY - 46, "crown").setDepth(20000);
    } else if (level < 3 && rec.crown) {
      rec.crown.destroy();
      rec.crown = undefined;
    }

    if (level >= 4 && !rec.auraTimer) {
      rec.auraTimer = this.scene.time.addEvent({ delay: 900, loop: true, callback: () => this.burstSparkle(rec) });
    } else if (level < 4 && rec.auraTimer) {
      rec.auraTimer.remove();
      rec.auraTimer = undefined;
    }

    // 등급이 오른 순간(승급) 한 번 반짝이는 축하 스파클
    if (level > rec.tier) this.burstSparkle(rec);
    rec.tier = level;
  }

  /** 전설 등급 지속 오라 + 승급 축하 이펙트 공용 — 기존 OfficeScene.sparkle()과 같은 방식의 즉발 파티클 */
  private burstSparkle(rec: BotRec): void {
    const em = this.scene.add.particles(rec.robotX, rec.robotY - 24, "spark", {
      speed: { min: 20, max: 70 },
      angle: { min: 0, max: 360 },
      lifespan: 500,
      scale: { start: 1.6, end: 0 },
      quantity: 8,
      emitting: false,
    });
    em.setDepth(20000);
    em.explode(8);
    this.scene.time.delayedCall(600, () => em.destroy());
  }

  private destroyRec(rec: BotRec): void {
    rec.blinkTween?.stop();
    rec.auraTimer?.remove();
    rec.plant?.destroy();
    rec.trophy?.destroy();
    rec.crown?.destroy();
    rec.desk.destroy();
    rec.robot.destroy();
    rec.light.destroy();
  }

  private showTooltip(botId: string): void {
    const bot = this.latestBots.find((b) => b.id === botId);
    const rec = this.recs.get(botId);
    if (!bot || !rec) return;

    this.tooltipIconBg.setFillStyle(badgeColorHex(bot.name));
    this.tooltipIconText.setText(botTypeIcon(bot.settings.botType));
    this.tooltipName.setText(bot.name);
    this.tooltipState.setText(BOT_STATE_LABEL[bot.state]).setColor(isBotBusyState(bot.state) ? AMBER : DARK);

    this.tooltipTier.setText(`등급 ${botTier(bot).label}`);

    this.tooltipMarket.setText(bot.targetNameKo ?? bot.targetMarket ?? "투자 대상 없음");
    const pnlColor = bot.currentPnlRate === null ? DARK : bot.currentPnlRate > 0 ? UP : bot.currentPnlRate < 0 ? DOWN : DARK;
    this.tooltipPnl.setText(formatBotPnl(bot)).setColor(pnlColor);

    this.tooltipSettings.setText(formatBotSettingsLine(bot));
    this.tooltipFoot.setText(formatBotFootLine(bot));

    // 위에서부터 실제 렌더 높이를 쌓아 word-wrap으로 줄 수가 늘어나도 항상 맞게 배경을 그린다
    const tierY = TIP_HEADER_H + 4;
    const row1Y = tierY + this.tooltipTier.height + 4;
    this.tooltipMarket.setPosition(TIP_PAD, row1Y);
    this.tooltipPnl.setPosition(TIP_W - TIP_PAD, row1Y);
    const row1H = Math.max(this.tooltipMarket.height, this.tooltipPnl.height);
    const settingsY = row1Y + row1H + 6;
    this.tooltipSettings.setPosition(TIP_PAD, settingsY);
    const footY = settingsY + this.tooltipSettings.height + 3;
    this.tooltipFoot.setPosition(TIP_PAD, footY);
    const totalH = footY + this.tooltipFoot.height + TIP_PAD;

    this.tooltipBg.clear();
    this.tooltipBg.fillStyle(TIP_CREAM, 1);
    this.tooltipBg.fillRect(0, 0, TIP_W, totalH);
    this.tooltipBg.fillStyle(TIP_HEADER_BAND, 1);
    this.tooltipBg.fillRect(0, 0, TIP_W, TIP_HEADER_H);
    this.tooltipBg.lineStyle(1, TIP_INK, 0.4);
    this.tooltipBg.lineBetween(0, TIP_HEADER_H, TIP_W, TIP_HEADER_H);
    this.tooltipBg.lineStyle(3, TIP_INK, 1);
    this.tooltipBg.strokeRect(1.5, 1.5, TIP_W - 3, totalH - 3);

    // 위쪽 방(맨 위 줄) 로봇은 왼쪽방 상단 버튼 바(DOM, top:68px)에 잘릴 수 있어 그 아래로 최소 y를 클램프한다
    this.tooltipContainer.setPosition(rec.robotX - TIP_W / 2, Math.max(104, rec.robotY - 40 - totalH));
    this.tooltipContainer.setVisible(true);
  }

  private hideTooltip(): void {
    this.tooltipContainer.setVisible(false);
  }
}
