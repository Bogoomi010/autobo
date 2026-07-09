/**
 * 매수봇 상세 패널 — 왼쪽 방 로봇을 클릭하면 뜬다.
 * 지금 어떤 코인에 투자 중인지, 실시간 수익률, 그리고 조준~매수~매도까지의 활동 로그를 보여준다.
 * EV.OPEN_BOT_DETAIL(botId) 수신 시 열림 → 닫힐 때 EV.BOT_DETAIL_CLOSED 를 1회 방송한다.
 */
import { botEngine } from "../bots/botEngine";
import { BOT_STATE_LABEL, botTier, botTypeIcon, botTypeLabel, formatBotFootLine, formatBotSettingsLine, isBotBusyState } from "../bots/botFormat";
import type { TradeBot } from "../bots/types";
import { bus, EV } from "../game/events";
import { pct } from "../game/format";
import { badgeColor } from "./uiKit";

const STYLE_ID = "bot-detail-modal-style";

function injectStyleOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #botDetailModal {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(26, 20, 16, 0.62);
      pointer-events: auto;
      z-index: 90;
      font-family: "Galmuri11", "Malgun Gothic", sans-serif;
    }
    #botDetailModal.open { display: flex; }
    #botDetailModal .bdm-panel {
      width: 420px;
      max-height: min(600px, calc(100% - 40px));
      background: #f7ecd4;
      border: 4px solid #3d2a1a;
      border-radius: 2px;
      box-shadow: 0 4px 0 #3d2a1a;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #3d2a1a;
    }
    #botDetailModal .bdm-head {
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: #efe0c0;
      border-bottom: 4px solid #3d2a1a;
    }
    #botDetailModal .bdm-icon {
      flex: none;
      width: 30px;
      height: 30px;
      border: 3px solid #3d2a1a;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    #botDetailModal .bdm-name { flex: 1; font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #botDetailModal .bdm-state { flex: none; font-size: 11px; color: #8a5a33; }
    #botDetailModal .bdm-state.busy { color: #b8860b; }
    #botDetailModal .bdm-close {
      flex: none;
      width: 28px;
      height: 28px;
      border: 3px solid #3d2a1a;
      border-radius: 2px;
      background: #f7ecd4;
      color: #3d2a1a;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 0 #3d2a1a;
    }
    #botDetailModal .bdm-close:hover { background: #f26d5b; color: #f7ecd4; transform: translateY(1px); box-shadow: 0 1px 0 #3d2a1a; }
    #botDetailModal .bdm-body { flex: none; padding: 12px; border-bottom: 3px solid #3d2a1a; }
    #botDetailModal .bdm-tier { font-size: 11px; font-weight: 700; color: #3d2a1a; margin-bottom: 6px; }
    #botDetailModal .bdm-market-row { display: flex; align-items: baseline; justify-content: space-between; }
    #botDetailModal .bdm-market { font-size: 15px; font-weight: 700; }
    #botDetailModal .bdm-pnl { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
    #botDetailModal .bdm-pnl.up { color: #e5484d; }
    #botDetailModal .bdm-pnl.down { color: #3b82f6; }
    #botDetailModal .bdm-settings { margin-top: 6px; font-size: 11px; color: #8a5a33; }
    #botDetailModal .bdm-foot { margin-top: 2px; font-size: 11px; color: #8a5a33; }
    #botDetailModal .bdm-log-title { flex: none; padding: 8px 12px 4px; font-size: 12px; font-weight: 700; color: #8a5a33; }
    #botDetailModal .bdm-log-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 4px; }
    #botDetailModal .bdm-log-row { font-size: 11px; line-height: 1.4; display: flex; gap: 6px; }
    #botDetailModal .bdm-log-row .t { flex: none; color: #b0906a; font-variant-numeric: tabular-nums; }
    #botDetailModal .bdm-log-row .m { flex: 1; word-break: break-word; }
    #botDetailModal .bdm-log-empty { margin: auto; font-size: 11px; color: #8a5a33; padding: 16px 0; text-align: center; }
  `;
  document.head.appendChild(style);
}

export function initBotDetailModal(): void {
  injectStyleOnce();
  const ui = document.getElementById("ui")!;

  const overlay = document.createElement("div");
  overlay.id = "botDetailModal";

  const panel = document.createElement("div");
  panel.className = "bdm-panel";

  const head = document.createElement("div");
  head.className = "bdm-head";
  const icon = document.createElement("div");
  icon.className = "bdm-icon";
  const name = document.createElement("div");
  name.className = "bdm-name";
  const state = document.createElement("div");
  state.className = "bdm-state";
  const closeBtn = document.createElement("button");
  closeBtn.className = "bdm-close";
  closeBtn.textContent = "✕";
  head.append(icon, name, state, closeBtn);

  const body = document.createElement("div");
  body.className = "bdm-body";
  const tierEl = document.createElement("div");
  tierEl.className = "bdm-tier";
  const marketRow = document.createElement("div");
  marketRow.className = "bdm-market-row";
  const market = document.createElement("div");
  market.className = "bdm-market";
  const pnl = document.createElement("div");
  pnl.className = "bdm-pnl";
  marketRow.append(market, pnl);
  const settings = document.createElement("div");
  settings.className = "bdm-settings";
  const foot = document.createElement("div");
  foot.className = "bdm-foot";
  body.append(tierEl, marketRow, settings, foot);

  const logTitle = document.createElement("div");
  logTitle.className = "bdm-log-title";
  logTitle.textContent = "📜 활동 로그";
  const logList = document.createElement("div");
  logList.className = "bdm-log-list";

  panel.append(head, body, logTitle, logList);
  overlay.append(panel);
  ui.append(overlay);

  // ── 상태 ───────────────────────────────────────────────────
  let isOpen = false;
  let openBotId: string | null = null;

  function findBot(): TradeBot | undefined {
    return openBotId ? botEngine.getBots().find((b) => b.id === openBotId) : undefined;
  }

  function render(bot: TradeBot): void {
    icon.textContent = botTypeIcon(bot.settings.botType);
    icon.style.background = badgeColor(bot.name);
    name.textContent = `${bot.name} (${botTypeLabel(bot.settings.botType)})`;
    state.textContent = BOT_STATE_LABEL[bot.state];
    state.classList.toggle("busy", isBotBusyState(bot.state));
    tierEl.textContent = `등급 ${botTier(bot).label}`;

    market.textContent = bot.targetNameKo ?? bot.targetMarket ?? "투자 대상 없음";
    if (bot.currentPnlRate !== null) {
      pnl.textContent = pct(bot.currentPnlRate);
      pnl.className = `bdm-pnl ${bot.currentPnlRate > 0 ? "up" : bot.currentPnlRate < 0 ? "down" : ""}`.trim();
    } else {
      pnl.textContent = "";
      pnl.className = "bdm-pnl";
    }
    settings.textContent = formatBotSettingsLine(bot);
    foot.textContent = formatBotFootLine(bot);

    logList.replaceChildren();
    if (bot.logs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bdm-log-empty";
      empty.textContent = "아직 활동 로그가 없어요.";
      logList.append(empty);
    } else {
      for (const entry of [...bot.logs].reverse()) {
        const row = document.createElement("div");
        row.className = "bdm-log-row";
        const t = document.createElement("span");
        t.className = "t";
        t.textContent = new Date(entry.at).toLocaleTimeString("ko-KR", { hour12: false });
        const m = document.createElement("span");
        m.className = "m";
        m.textContent = entry.message;
        row.append(t, m);
        logList.append(row);
      }
    }
  }

  // ── 열기/닫기 ──────────────────────────────────────────────
  function open(botId: string): void {
    const bot = botEngine.getBots().find((b) => b.id === botId);
    if (!bot) return;
    isOpen = true;
    openBotId = botId;
    overlay.classList.add("open");
    render(bot);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    openBotId = null;
    overlay.classList.remove("open");
    bus.emit(EV.BOT_DETAIL_CLOSED);
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    e.stopPropagation(); // 게임 캔버스로 키 입력 전파 차단
  });

  bus.on(EV.OPEN_BOT_DETAIL, (botId: string) => open(botId));

  // 실시간 갱신 — 열려 있는 봇의 코인/수익률/로그를 tick마다 반영. 봇이 삭제되면 자동으로 닫는다.
  bus.on(EV.BOTS_CHANGED, () => {
    if (!isOpen) return;
    const bot = findBot();
    if (!bot) {
      close();
      return;
    }
    render(bot);
  });
}
