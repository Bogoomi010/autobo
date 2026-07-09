/**
 * 로봇 매수봇 컨트롤 바 — 왼쪽 방(매수봇 공간) 최상단에 떠 있는 버튼 3개짜리 얇은 바.
 * 개별 봇 카드는 이제 월드의 로봇(botFloor.ts, 호버 툴팁/클릭 상세 패널)로 대체됐다.
 */
import { botEngine } from "../bots/botEngine";
import type { TradeBot } from "../bots/types";
import { bus, EV } from "../game/events";

const STYLE_ID = "bot-dock-style";

function injectStyleOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #botDock {
      position: absolute;
      left: 32px;
      top: 68px;
      width: 384px;
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: #efe0c0;
      border: 3px solid #3d2a1a;
      border-radius: 2px;
      box-shadow: 0 4px 0 #3d2a1a;
      font-family: "Galmuri11", "Malgun Gothic", sans-serif;
      color: #3d2a1a;
      z-index: 40;
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
  `;
  document.head.appendChild(style);
}

export function initBotDock(): void {
  injectStyleOnce();
  const ui = document.getElementById("ui")!;

  const root = document.createElement("div");
  root.id = "botDock";

  const title = document.createElement("div");
  title.className = "bd-title";
  title.textContent = "🤖 매수봇";
  const scanDot = document.createElement("div");
  scanDot.className = "bd-scan-dot";
  scanDot.title = "매수봇 스캔 창이 열려 있으면 켜짐";
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
  root.append(title, scanDot, spacer, scanBtn, addBtn, toggleBtn);
  ui.append(root);

  toggleBtn.addEventListener("click", () => botEngine.setEnabled(!botEngine.isEnabled()));
  addBtn.addEventListener("click", () => bus.emit(EV.OPEN_BOT_CREATE_MODAL));
  scanBtn.addEventListener("click", () => botEngine.triggerScanNow());

  function renderToggle(enabled: boolean): void {
    toggleBtn.textContent = enabled ? "봇 켜짐" : "봇 꺼짐";
    toggleBtn.classList.toggle("off", !enabled);
  }

  renderToggle(botEngine.isEnabled());
  scanDot.classList.toggle("active", botEngine.getScanActive());

  bus.on(EV.BOTS_CHANGED, (_bots: TradeBot[], meta: { enabled: boolean; scanActive: boolean }) => {
    renderToggle(meta.enabled);
    scanDot.classList.toggle("active", meta.scanActive);
  });
}
