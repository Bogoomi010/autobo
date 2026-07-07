/**
 * [파트 C] DOM HUD
 * 상단 바(금고/들고 있는 돈/총 자산/API 램프) + 우측 포지션 패널(실시간 손익) +
 * 거래 로그 + 토스트. 초기값은 store에서 직접 읽고 이후 bus 이벤트를 구독한다.
 */
import { STOP_LOSS_RATE, TAKE_PROFIT_RATE } from "../game/config";
import { bus, EV } from "../game/events";
import { krw, pct } from "../game/format";
import { store } from "../game/state";
import type { ClosedTrade, Position, Ticker } from "../game/types";
import { makeBadge, signClass } from "./uiKit";

/** 최신 시세 캐시 (포지션 손익 재계산용) */
let tickers = new Map<string, Ticker>();

export function initHud(): void {
  const ui = document.getElementById("ui")!;

  // ── 상단 바 ────────────────────────────────────────────────
  const topbar = el("div", "", { id: "topbar" });

  // 모드 뱃지 — 실거래(레드/골드, 실제 돈 인지) / 모의(민트)
  const modeBadge =
    store.mode === "real"
      ? el("div", "mode-badge real", { text: "⚠ 실거래" })
      : el("div", "mode-badge sim", { text: "🧪 모의" });

  const vaultEl = statBox("🔐", "금고");
  const carryEl = statBox("💰", "지갑");
  carryEl.box.classList.add("carry");
  const totalEl = statBox("📈", "총 자산");
  totalEl.box.classList.add("total");

  // 주문 처리 중 인디케이터 (기본 숨김)
  const orderBusy = el("div", "order-busy", { text: "⏳ 주문 처리 중…" });

  // 계좌 연동 상태 + 재연동/키 설정 버튼
  const connect = el("div", "connect");
  const connectText = el("span", "", { text: "계좌 연동 중…" });
  const reconnectBtn = el("button", "pixel-btn tiny reconnect", { text: "재연동" });
  const keyBtn = el("button", "pixel-btn tiny keybtn", { text: "🔑" });
  keyBtn.title = "API Key 입력/변경";
  connect.append(connectText, reconnectBtn);
  if (store.mode === "real") connect.append(keyBtn); // 모의 모드는 키 불필요

  // 시세 연결 램프 (EV.API_STATUS — 계좌 연동과 구분)
  const api = el("div", "api");
  const lamp = el("span", "lamp off");
  const apiText = el("span", "", { text: "시세 연결 중…" });
  api.append(lamp, apiText);

  topbar.append(
    modeBadge,
    vaultEl.box,
    carryEl.box,
    totalEl.box,
    el("div", "spacer"),
    orderBusy,
    connect,
    api
  );

  // 재연동 버튼 — 연타 방지 후 store.connect()
  reconnectBtn.addEventListener("click", async () => {
    (reconnectBtn as HTMLButtonElement).disabled = true;
    await store.connect();
    // 결과는 EV.CONNECT 구독이 반영 (성공 시 버튼 숨김)
    (reconnectBtn as HTMLButtonElement).disabled = false;
  });

  // 키 설정 버튼 — API Key 입력 모달 열기
  keyBtn.addEventListener("click", () => bus.emit(EV.OPEN_KEY_MODAL));

  // ── 우측 포지션 패널 ───────────────────────────────────────
  const panel = el("div", "", { id: "positions" });
  const posHead = el("div", "panel-head", { text: "📊 투자 현황" });
  const posList = el("div", "", { id: "posList" });

  const tradeLog = el("div", "", { id: "tradeLog" });
  const tlHead = el("div", "tl-head", { text: "🧾 최근 청산" });
  const tlRows = el("div", "", { id: "tlRows" });
  tradeLog.append(tlHead, tlRows);

  panel.append(posHead, posList, tradeLog);

  // ── 토스트 컨테이너 ────────────────────────────────────────
  const toasts = el("div", "", { id: "toasts" });

  ui.append(topbar, panel, toasts);

  // ── 렌더 함수 ──────────────────────────────────────────────
  function renderWallet(balance: number): void {
    vaultEl.val.textContent = krw(balance);
  }
  function renderCarry(carried: number): void {
    carryEl.val.textContent = krw(carried);
    carryEl.box.classList.toggle("empty", carried <= 0);
  }
  function renderTotal(): void {
    totalEl.val.textContent = krw(store.totalAssets());
  }

  function renderPositions(positions: Position[]): void {
    posList.replaceChildren();
    if (positions.length === 0) {
      posList.append(
        el("div", "empty", { html: "투자 중인 코인이<br>없어요 🪙" })
      );
      renderTotal();
      return;
    }
    for (const p of positions) posList.append(posCard(p));
    renderTotal();
  }

  /** TICKERS 수신 시 각 포지션 카드의 손익만 갱신 (전체 리렌더 X) */
  function refreshPnl(): void {
    for (const card of Array.from(posList.querySelectorAll<HTMLElement>(".pos-card"))) {
      if (card.dataset.status === "selling") continue; // 매도 중 카드는 손익 갱신 안 함
      const market = card.dataset.market!;
      const entry = Number(card.dataset.entry);
      const t = tickers.get(market);
      const pnlEl = card.querySelector<HTMLElement>(".pos-pnl")!;
      const fill = card.querySelector<HTMLElement>(".fill")!;
      if (!t || entry <= 0) {
        pnlEl.textContent = "—";
        pnlEl.className = "pos-pnl num";
        return;
      }
      const rate = t.price / entry - 1;
      pnlEl.textContent = pct(rate);
      pnlEl.className = `pos-pnl num ${signClass(rate)}`;
      applyGauge(fill, rate);
    }
    renderTotal();
  }

  function renderTrades(trades: ClosedTrade[]): void {
    tlRows.replaceChildren();
    if (trades.length === 0) {
      tlRows.append(el("div", "tl-empty", { text: "아직 청산 기록이 없어요." }));
      return;
    }
    for (const t of trades.slice(0, 5)) tlRows.append(tradeRow(t));
  }

  // ── 초기 렌더 (store 직접 읽기) ────────────────────────────
  renderWallet(store.vaultBalance());
  renderCarry(store.carried);
  renderPositions(store.positions);
  renderTrades(store.trades);
  renderTotal();

  // ── bus 구독 ───────────────────────────────────────────────
  bus.on(EV.WALLET, (balance: number) => {
    renderWallet(balance);
    renderTotal();
  });
  bus.on(EV.CARRY, (carried: number) => {
    renderCarry(carried);
    renderTotal();
  });
  bus.on(EV.POSITIONS, (positions: Position[]) => renderPositions(positions));
  bus.on(EV.TICKERS, (map: Map<string, Ticker>) => {
    tickers = map;
    refreshPnl();
  });
  bus.on(EV.API_STATUS, (ok: boolean) => {
    lamp.className = `lamp ${ok ? "on" : "off"}`;
    apiText.textContent = ok ? "시세 연결됨" : "시세 끊김";
  });

  // 계좌 연동 상태 — 연동 중(노랑)/연동됨(초록)/실패(빨강 + 재연동 버튼)
  bus.on(EV.CONNECT, (state: "none" | "connecting" | "connected" | "error", detail?: string) => {
    connect.classList.remove("connecting", "connected", "error");
    reconnectBtn.style.display = "none";
    connect.removeAttribute("title");
    switch (state) {
      case "connecting":
        connect.classList.add("connecting");
        connectText.textContent = "연동 중…";
        break;
      case "connected":
        connect.classList.add("connected");
        // detail "sim" = 모의 모드 (실계좌 아님)
        connectText.textContent = detail === "sim" ? "모의 계좌" : "계좌 연동됨";
        break;
      case "error":
        connect.classList.add("error");
        connectText.textContent = "연동 실패";
        if (detail) connect.title = detail; // 짧은 사유 툴팁
        reconnectBtn.style.display = "";
        break;
      default:
        connectText.textContent = "미연동";
        reconnectBtn.style.display = "";
    }
  });

  // 주문 진행 중 인디케이터
  bus.on(EV.ORDER_BUSY, (busy: boolean) => {
    orderBusy.classList.toggle("on", busy);
  });
  bus.on(EV.TRADE_CLOSED, (t: ClosedTrade) => {
    renderTrades(store.trades);
    // 청산 자동 토스트 (익절=good / 손절=bad)
    const good = t.reason === "take-profit";
    const emoji = good ? "✨" : "💥";
    const word = good ? "익절" : "손절";
    showToast(
      `${emoji} ${t.nameKo} ${pct(t.pnlRate)} ${word} → ${krw(t.payout)}`,
      good ? "good" : "bad"
    );
  });
  bus.on(EV.TOAST, (msg: string, kind?: "info" | "good" | "bad") =>
    showToast(msg, kind ?? "info")
  );

  // ── 토스트 스택 (자동 소멸) ────────────────────────────────
  function showToast(msg: string, kind: "info" | "good" | "bad"): void {
    const t = el("div", `toast ${kind}`, { text: msg });
    toasts.append(t);
    setTimeout(() => {
      t.classList.add("out");
      setTimeout(() => t.remove(), 320);
    }, 2600);
  }
}

/** 포지션 카드 DOM 생성 */
function posCard(p: Position): HTMLElement {
  const card = el("div", "pos-card");
  card.dataset.market = p.market;
  card.dataset.entry = String(p.entryPrice);
  card.dataset.status = p.status;

  const top = el("div", "pos-top");
  const badge = makeBadge(p.symbol);
  const name = el("div", "pos-name");
  name.append(
    el("span", "ko", { text: p.nameKo }),
    el("span", "amt", { text: `투자 ${krw(p.investedKrw)}` })
  );
  const pnl = el("div", "pos-pnl num", { text: "—" });
  top.append(badge, name, pnl);

  const gauge = el("div", "pos-gauge");
  gauge.append(el("div", "mid"), el("div", "fill"));

  card.append(top, gauge);

  // 매도 주문 진행 중 — 손익 대신 상태 표시 + 카드 흐리게
  if (p.status === "selling") {
    card.classList.add("selling");
    pnl.textContent = "💸 매도 중…";
    pnl.className = "pos-pnl selling-label";
    return card;
  }

  // 진입 직후 최신 시세로 즉시 1회 반영
  const t = tickers.get(p.market);
  if (t && p.entryPrice > 0) {
    const rate = t.price / p.entryPrice - 1;
    pnl.textContent = pct(rate);
    pnl.className = `pos-pnl num ${signClass(rate)}`;
    applyGauge(gauge.querySelector<HTMLElement>(".fill")!, rate);
  }
  return card;
}

/** 손익 게이지 — 중앙 기준 좌(손절 -3%)/우(익절 +3%)로 채움 */
function applyGauge(fill: HTMLElement, rate: number): void {
  const half = 50; // 중앙에서 한쪽 끝까지 %
  if (rate >= 0) {
    const ratio = Math.min(1, rate / TAKE_PROFIT_RATE);
    fill.className = "fill up";
    fill.style.left = "50%";
    fill.style.width = `${ratio * half}%`;
  } else {
    const ratio = Math.min(1, rate / STOP_LOSS_RATE); // 둘 다 음수 → 양수 비율
    fill.className = "fill down";
    fill.style.width = `${ratio * half}%`;
    fill.style.left = `${50 - ratio * half}%`;
  }
}

/** 거래 로그 한 줄 */
function tradeRow(t: ClosedTrade): HTMLElement {
  const good = t.reason === "take-profit";
  const emoji = good ? "✨" : "💥";
  const word = good ? "익절" : "손절";
  const row = el("div", "tl-row");
  row.innerHTML =
    `${emoji} ${escapeHtml(t.nameKo)} ` +
    `<span class="num ${signClass(t.pnlRate)}">${pct(t.pnlRate)}</span> ` +
    `${word} → <span class="num">${krw(t.payout)}</span>`;
  return row;
}

/** 상단 바 통계 박스 (아이콘 + 라벨 + 값) */
function statBox(icon: string, label: string): { box: HTMLElement; val: HTMLElement } {
  const box = el("div", "stat");
  const val = el("b", "num", { text: "₩0" });
  box.append(
    el("span", "ic", { text: icon }),
    el("span", "lbl", { text: label }),
    val
  );
  return { box, val };
}

/** 간결한 DOM 생성 헬퍼 */
function el(
  tag: string,
  className = "",
  opts: { id?: string; text?: string; html?: string } = {}
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (opts.id) node.id = opts.id;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  return node;
}

/** 사용자 입력(코인명) HTML 이스케이프 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
