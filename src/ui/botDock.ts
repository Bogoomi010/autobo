/**
 * 로봇 매수봇 도크 — 화면 좌하단 코너에 떠 있는 소형 패널.
 * 게임 월드 레이아웃(충돌 영역 등)에 영향을 주지 않도록 고정 폭의 코너 위젯으로 구현한다.
 */
import { botEngine } from "../bots/botEngine";
import type { BotState, TradeBot } from "../bots/types";
import { bus, EV } from "../game/events";
import { krw, pct } from "../game/format";
import { badgeColor } from "./uiKit";

const STYLE_ID = "bot-dock-style";

const STATE_LABEL: Record<BotState, string> = {
  idle: "대기 중",
  scanning: "탐색 중",
  targeting: "조준!",
  buying: "매수 중",
  holding: "보유 중",
  selling: "매도 중",
  sold_profit: "익절 완료",
  sold_loss: "손절 완료",
  error: "오류",
};

function injectStyleOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #botDock {
      position: absolute;
      left: 14px;
      bottom: 14px;
      width: 460px;
      max-width: calc(100% - 28px);
      pointer-events: auto;
      background: #f7ecd4;
      border: 3px solid #3d2a1a;
      border-radius: 2px;
      box-shadow: 0 4px 0 #3d2a1a;
      font-family: "Galmuri11", "Malgun Gothic", sans-serif;
      color: #3d2a1a;
      display: flex;
      flex-direction: column;
      z-index: 40;
    }
    #botDock .bd-head {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: #efe0c0;
      border-bottom: 3px solid #3d2a1a;
      flex-wrap: wrap;
    }
    #botDock .bd-title { font-size: 12px; font-weight: 700; flex: none; }
    #botDock .bd-spacer { flex: 1; }
    #botDock .bd-scan-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #b0a488; flex: none;
    }
    #botDock .bd-scan-dot.active {
      background: #2fbf9b;
      animation: bd-pulse 1.2s ease-in-out infinite;
    }
    @keyframes bd-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(47,191,155,0.6); }
      50% { box-shadow: 0 0 0 4px rgba(47,191,155,0); }
    }
    #botDock button.bd-btn {
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      color: #f7ecd4;
      background: #2fbf9b;
      border: 2px solid #3d2a1a;
      border-radius: 2px;
      padding: 4px 8px;
      cursor: pointer;
      box-shadow: 0 2px 0 #3d2a1a;
      flex: none;
    }
    #botDock button.bd-btn:hover { transform: translateY(1px); box-shadow: 0 1px 0 #3d2a1a; }
    #botDock button.bd-btn:active { transform: translateY(2px); box-shadow: none; }
    #botDock button.bd-btn.off { background: #b0a488; }
    #botDock button.bd-btn.coral { background: #f26d5b; }
    #botDock .bd-list {
      display: flex;
      gap: 6px;
      padding: 8px;
      overflow-x: auto;
      min-height: 74px;
    }
    #botDock .bd-empty {
      margin: auto;
      font-size: 11px;
      color: #8a5a33;
      padding: 8px;
    }
    #botDock .bd-card {
      flex: none;
      width: 122px;
      background: #fff;
      border: 2px solid #3d2a1a;
      border-radius: 2px;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      position: relative;
    }
    #botDock .bd-card .bd-remove {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 14px;
      height: 14px;
      line-height: 12px;
      text-align: center;
      font-size: 10px;
      color: #8a5a33;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0;
    }
    #botDock .bd-card .bd-remove:hover { color: #e5484d; }
    #botDock .bd-top { display: flex; align-items: center; gap: 4px; }
    #botDock .bd-icon {
      width: 18px; height: 18px; border-radius: 2px; border: 2px solid #3d2a1a;
      display: flex; align-items: center; justify-content: center; font-size: 10px; flex: none;
    }
    #botDock .bd-name { font-size: 11px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #botDock .bd-state { font-size: 10px; color: #8a5a33; }
    #botDock .bd-state.buying, #botDock .bd-state.selling, #botDock .bd-state.targeting {
      color: #b8860b; animation: bd-blink 1s ease-in-out infinite;
    }
    @keyframes bd-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    #botDock .bd-market { font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #botDock .bd-pnl { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
    #botDock .bd-pnl.up { color: #e5484d; }
    #botDock .bd-pnl.down { color: #3b82f6; }
    #botDock .bd-settings { font-size: 9px; color: #8a5a33; line-height: 1.35; }
    #botDock .bd-foot { font-size: 9px; color: #8a5a33; }
  `;
  document.head.appendChild(style);
}

export function initBotDock(): void {
  injectStyleOnce();
  const ui = document.getElementById("ui")!;

  const root = document.createElement("div");
  root.id = "botDock";

  const head = document.createElement("div");
  head.className = "bd-head";
  const title = document.createElement("div");
  title.className = "bd-title";
  title.textContent = "🤖 매수봇";
  const scanDot = document.createElement("div");
  scanDot.className = "bd-scan-dot";
  scanDot.title = "09:00~09:30 KST 자동 스캔 중 켜짐";
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "bd-btn";
  const addBtn = document.createElement("button");
  addBtn.className = "bd-btn";
  addBtn.textContent = "+봇 추가";
  const scanBtn = document.createElement("button");
  scanBtn.className = "bd-btn coral";
  scanBtn.textContent = "지금 스캔";
  scanBtn.title = "5분간 즉시 급등 스캔을 시작합니다";

  const spacer = document.createElement("div");
  spacer.className = "bd-spacer";
  head.append(title, scanDot, spacer, scanBtn, addBtn, toggleBtn);

  const list = document.createElement("div");
  list.className = "bd-list";

  root.append(head, list);
  ui.append(root);

  toggleBtn.addEventListener("click", () => botEngine.setEnabled(!botEngine.isEnabled()));
  addBtn.addEventListener("click", () => bus.emit(EV.OPEN_BOT_CREATE_MODAL));
  scanBtn.addEventListener("click", () => botEngine.triggerScanNow());

  function renderToggle(enabled: boolean): void {
    toggleBtn.textContent = enabled ? "봇 켜짐" : "봇 꺼짐";
    toggleBtn.classList.toggle("off", !enabled);
  }

  function cardFor(bot: TradeBot): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "bd-card";

    const remove = document.createElement("button");
    remove.className = "bd-remove";
    remove.textContent = "✕";
    remove.title = "봇 삭제";
    remove.addEventListener("click", () => botEngine.removeBot(bot.id));

    const top = document.createElement("div");
    top.className = "bd-top";
    const icon = document.createElement("div");
    icon.className = "bd-icon";
    icon.textContent = "🤖";
    icon.style.background = badgeColor(bot.name);
    const name = document.createElement("div");
    name.className = "bd-name";
    name.textContent = bot.name;
    top.append(icon, name);

    const state = document.createElement("div");
    state.className = `bd-state ${bot.state}`;
    state.textContent = STATE_LABEL[bot.state];

    const market = document.createElement("div");
    market.className = "bd-market";
    market.textContent = bot.targetNameKo ?? (bot.targetMarket ? bot.targetMarket : " ");

    const pnl = document.createElement("div");
    pnl.className = "bd-pnl";
    if (bot.currentPnlRate !== null) {
      pnl.textContent = pct(bot.currentPnlRate);
      const cls = bot.currentPnlRate > 0 ? "up" : bot.currentPnlRate < 0 ? "down" : "";
      pnl.className = `bd-pnl ${cls}`.trim();
    } else {
      pnl.textContent = " ";
    }

    const settings = document.createElement("div");
    settings.className = "bd-settings";
    const sw = bot.settings.scanWindow;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    settings.textContent = `${krw(bot.settings.budgetKrw)} · ${pad2(sw.startHourKst)}:${pad2(sw.startMinute)}(${sw.durationMinutes}분) · +${(bot.settings.takeProfitRate * 100).toFixed(1)}%/-${(bot.settings.stopLossRate * 100).toFixed(1)}%`;

    const foot = document.createElement("div");
    foot.className = "bd-foot";
    foot.textContent = `누적 ${krw(bot.realizedPnlKrw)} · ${bot.tradesDone}건`;

    card.append(remove, top, state, market, pnl, settings, foot);
    return card;
  }

  function render(bots: TradeBot[], meta: { enabled: boolean; scanActive: boolean }): void {
    renderToggle(meta.enabled);
    scanDot.classList.toggle("active", meta.scanActive);

    list.replaceChildren();
    if (bots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bd-empty";
      empty.textContent = "봇이 없어요. '+봇 추가'로 시작하세요.";
      list.append(empty);
      return;
    }
    for (const bot of bots) list.append(cardFor(bot));
  }

  render(botEngine.getBots(), { enabled: botEngine.isEnabled(), scanActive: botEngine.getScanActive() });

  bus.on(EV.BOTS_CHANGED, (bots: TradeBot[], meta: { enabled: boolean; scanActive: boolean; lastScanAt: number | null }) => {
    render(bots, meta);
  });
}
