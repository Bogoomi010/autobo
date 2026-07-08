/**
 * [트레이딩 보드] 업비트 실사이트 스타일 대시보드 오케스트레이터.
 * chart.ts(캔들+거래량) / marketList.ts(원화 마켓 목록) / tickFeed.ts(실시간 체결)를 조립한다.
 * 거실 시세판 오브젝트 전용 — 투자(매수)는 여전히 투자방 단말기(coinModal)에서만 이루어진다.
 * EV.OPEN_TRADING_BOARD 수신 시 열림 → 닫힐 때 EV.TRADING_BOARD_CLOSED 를 1회 방송한다.
 */
import { fetchCandles } from "../../api/upbit";
import { bus, EV } from "../../game/events";
import { coinPrice, krw, pct } from "../../game/format";
import type { Candle, CandleUnit, CoinInfo, Ticker, TradeTick } from "../../game/types";
import { investment } from "../../systems/InvestmentSystem";
import { createPriceChart, type PriceChart } from "./chart";
import { createMarketList, type MarketList } from "./marketList";
import { createTickFeed, type TickFeed } from "./tickFeed";

const DEFAULT_MARKET = "KRW-BTC";
const DEFAULT_UNIT: CandleUnit = "1d";
const CANDLE_COUNT = 200;

const TIMEFRAMES: { key: CandleUnit; label: string }[] = [
  { key: "seconds", label: "초" },
  { key: "1m", label: "1분" },
  { key: "3m", label: "3분" },
  { key: "5m", label: "5분" },
  { key: "10m", label: "10분" },
  { key: "15m", label: "15분" },
  { key: "30m", label: "30분" },
  { key: "60m", label: "1시간" },
  { key: "240m", label: "4시간" },
  { key: "1d", label: "일" },
  { key: "1w", label: "주" },
  { key: "1mo", label: "월" },
  { key: "1y", label: "년" },
];

/** 타임프레임 → 캔들 하나의 길이(초). 실시간 틱을 캔들에 버킷팅할 때만 쓰는 근사치(월/년 포함). */
const UNIT_SECONDS: Record<CandleUnit, number> = {
  seconds: 1,
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "10m": 600,
  "15m": 900,
  "30m": 1800,
  "60m": 3600,
  "240m": 14400,
  "1d": 86400,
  "1w": 604800,
  "1mo": 2592000,
  "1y": 31536000,
};

const STYLE_ID = "trading-board-style";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #tradingBoard {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(20, 24, 28, 0.55);
      pointer-events: auto;
      z-index: 82;
      font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    #tradingBoard.open { display: flex; }
    #tradingBoard .tb-panel {
      width: 1180px;
      height: 660px;
      background: #ffffff;
      border: 1px solid #ebeef1;
      border-radius: 6px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #1e2329;
    }
    #tradingBoard .tb-header {
      flex: none;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 16px;
      background: #f9fafb;
      border-bottom: 1px solid #ebeef1;
    }
    #tradingBoard .tb-badge {
      flex: none;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: #1e2329;
    }
    #tradingBoard .tb-name { flex: none; display: flex; flex-direction: column; line-height: 1.25; min-width: 96px; }
    #tradingBoard .tb-name .ko { font-size: 14px; font-weight: 700; }
    #tradingBoard .tb-name .sym { font-size: 11px; color: #8b95a1; }
    #tradingBoard .tb-price {
      flex: none;
      font-size: 28px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      transition: background-color 0.25s ease;
      padding: 2px 6px;
      border-radius: 4px;
    }
    #tradingBoard .tb-price.flash-up { background-color: rgba(210, 79, 69, 0.16); }
    #tradingBoard .tb-price.flash-down { background-color: rgba(18, 97, 196, 0.16); }
    #tradingBoard .tb-change {
      flex: none;
      display: flex;
      flex-direction: column;
      line-height: 1.25;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
    #tradingBoard .tb-stats {
      flex: 1;
      display: flex;
      gap: 18px;
      justify-content: flex-end;
      font-size: 12px;
      color: #8b95a1;
      font-variant-numeric: tabular-nums;
    }
    #tradingBoard .tb-stats b { color: #1e2329; font-weight: 600; margin-left: 4px; }
    #tradingBoard .tb-up { color: #d24f45; }
    #tradingBoard .tb-down { color: #1261c4; }
    #tradingBoard .tb-close {
      flex: none;
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: #8b95a1;
      font-size: 16px;
      cursor: pointer;
      border-radius: 4px;
    }
    #tradingBoard .tb-close:hover { background: #ebeef1; color: #1e2329; }
    #tradingBoard .tb-body {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    #tradingBoard .tb-left {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid #ebeef1;
    }
    #tradingBoard .tb-tabs {
      flex: none;
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      padding: 6px 10px;
      border-bottom: 1px solid #ebeef1;
    }
    #tradingBoard .tb-tab {
      font-family: inherit;
      font-size: 12px;
      color: #8b95a1;
      background: transparent;
      border: none;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
    }
    #tradingBoard .tb-tab:hover { background: #f5f7fa; color: #1e2329; }
    #tradingBoard .tb-tab.active { background: #e8f3ff; color: #093687; font-weight: 700; }
    #tradingBoard .tb-chart-wrap {
      flex: 1;
      min-height: 0;
    }
    #tradingBoard .tb-right {
      flex: none;
      width: 320px;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    #tradingBoard .tb-market-wrap {
      flex: 1 1 58%;
      min-height: 0;
      border-bottom: 1px solid #ebeef1;
    }
    #tradingBoard .tb-tick-wrap {
      flex: 1 1 42%;
      min-height: 0;
    }
  `;
  document.head.appendChild(style);
}

export function initTradingBoard(): void {
  injectStyles();
  const ui = document.getElementById("ui")!;

  const overlay = document.createElement("div");
  overlay.id = "tradingBoard";
  ui.append(overlay);

  let isOpen = false;
  let market = DEFAULT_MARKET;
  let unit: CandleUnit = DEFAULT_UNIT;
  let marketsLoaded = false;
  let lastCandle: Candle | null = null;
  let lastPrice = 0;

  let chart: PriceChart | null = null;
  let marketListHandle: MarketList | null = null;
  let tickFeedHandle: TickFeed | null = null;
  let headPriceEl: HTMLDivElement | null = null;
  let headChangeEl: HTMLDivElement | null = null;
  let headBadgeEl: HTMLDivElement | null = null;
  let headKoEl: HTMLSpanElement | null = null;
  let headSymEl: HTMLSpanElement | null = null;
  let headStatsEl: HTMLDivElement | null = null;
  let tabButtons: Map<CandleUnit, HTMLButtonElement> = new Map();

  function currentCoin(): CoinInfo | undefined {
    return investment.getMarkets().find((m) => m.market === market);
  }

  /** 등락률로부터 전일 종가·등락액을 역산 (Ticker에 등락액 필드가 없어 근사 계산) */
  function changeAmount(ticker: Ticker): number {
    if (ticker.changeRate24h <= -1) return 0;
    const prevClose = ticker.price / (1 + ticker.changeRate24h);
    return ticker.price - prevClose;
  }

  function renderHeader(ticker: Ticker | undefined): void {
    const coin = currentCoin();
    if (headKoEl) headKoEl.textContent = coin?.nameKo ?? market;
    if (headSymEl) headSymEl.textContent = coin?.symbol ?? "";
    if (headBadgeEl) {
      const sym = coin?.symbol ?? market;
      headBadgeEl.textContent = sym.slice(0, sym.length >= 4 ? 2 : sym.length).toUpperCase();
    }
    if (!ticker) return;

    const cls = ticker.changeRate24h > 0 ? "tb-up" : ticker.changeRate24h < 0 ? "tb-down" : "";
    if (headPriceEl) {
      headPriceEl.textContent = `₩${coinPrice(ticker.price)}`;
      if (lastPrice > 0 && ticker.price !== lastPrice) {
        const flashCls = ticker.price > lastPrice ? "flash-up" : "flash-down";
        headPriceEl.classList.remove("flash-up", "flash-down");
        // 리플로우를 강제해 같은 방향 연속 갱신에도 애니메이션이 재생되게 한다
        void headPriceEl.offsetWidth;
        headPriceEl.classList.add(flashCls);
        setTimeout(() => headPriceEl?.classList.remove(flashCls), 280);
      }
      lastPrice = ticker.price;
    }
    if (headChangeEl) {
      headChangeEl.innerHTML =
        `<span class="${cls}">${pct(ticker.changeRate24h)}</span>` +
        `<span class="${cls}">${ticker.changeRate24h >= 0 ? "+" : ""}${krw(changeAmount(ticker))}</span>`;
    }
    if (headStatsEl) {
      headStatsEl.innerHTML =
        `<span>고가 <b class="tb-up">₩${coinPrice(ticker.high24h)}</b></span>` +
        `<span>저가 <b class="tb-down">₩${coinPrice(ticker.low24h)}</b></span>` +
        `<span>거래대금(24H) <b>${krw(ticker.accTradePrice24h)}</b></span>`;
    }
  }

  async function loadCandles(): Promise<void> {
    try {
      const candles = await fetchCandles(market, unit, CANDLE_COUNT);
      chart?.setData(candles);
      lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
    } catch {
      bus.emit(EV.TOAST, "차트 데이터를 불러오지 못했어요", "bad");
    }
  }

  function updateActiveTab(): void {
    tabButtons.forEach((btn, key) => btn.classList.toggle("active", key === unit));
  }

  function switchUnit(next: CandleUnit): void {
    if (next === unit) return;
    unit = next;
    updateActiveTab();
    void loadCandles();
  }

  function switchMarket(next: string): void {
    if (next === market) return;
    market = next;
    lastCandle = null;
    lastPrice = 0;
    marketListHandle?.setSelected(market);
    tickFeedHandle?.setMarket(market);
    renderHeader(investment.getTicker(market));
    void loadCandles();
  }

  function handleTick(tick: TradeTick): void {
    const bucketLen = UNIT_SECONDS[unit];
    const bucket = Math.floor(tick.time / 1000 / bucketLen) * bucketLen;
    if (lastCandle && lastCandle.time === bucket) {
      lastCandle = {
        ...lastCandle,
        close: tick.price,
        high: Math.max(lastCandle.high, tick.price),
        low: Math.min(lastCandle.low, tick.price),
        volume: lastCandle.volume + tick.volume,
      };
    } else {
      lastCandle = { time: bucket, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: tick.volume };
    }
    chart?.updateLast(lastCandle);
  }

  function build(): void {
    overlay.innerHTML = "";
    tabButtons = new Map();

    const panel = document.createElement("div");
    panel.className = "tb-panel";

    // 헤더
    const header = document.createElement("div");
    header.className = "tb-header";

    headBadgeEl = document.createElement("div");
    headBadgeEl.className = "tb-badge";
    headBadgeEl.style.background = "#e8f3ff";

    const nameBox = document.createElement("div");
    nameBox.className = "tb-name";
    headKoEl = document.createElement("span");
    headKoEl.className = "ko";
    headSymEl = document.createElement("span");
    headSymEl.className = "sym";
    nameBox.append(headKoEl, headSymEl);

    headPriceEl = document.createElement("div");
    headPriceEl.className = "tb-price";
    headChangeEl = document.createElement("div");
    headChangeEl.className = "tb-change";
    headStatsEl = document.createElement("div");
    headStatsEl.className = "tb-stats";

    const closeBtn = document.createElement("button");
    closeBtn.className = "tb-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", close);

    header.append(headBadgeEl, nameBox, headPriceEl, headChangeEl, headStatsEl, closeBtn);

    // 본문 — 좌측(탭+차트) / 우측(마켓리스트+체결피드)
    const body = document.createElement("div");
    body.className = "tb-body";

    const left = document.createElement("div");
    left.className = "tb-left";
    const tabs = document.createElement("div");
    tabs.className = "tb-tabs";
    for (const tf of TIMEFRAMES) {
      const btn = document.createElement("button");
      btn.className = "tb-tab";
      btn.textContent = tf.label;
      btn.addEventListener("click", () => switchUnit(tf.key));
      tabs.appendChild(btn);
      tabButtons.set(tf.key, btn);
    }
    const chartWrap = document.createElement("div");
    chartWrap.className = "tb-chart-wrap";
    left.append(tabs, chartWrap);

    const right = document.createElement("div");
    right.className = "tb-right";
    const marketWrap = document.createElement("div");
    marketWrap.className = "tb-market-wrap";
    const tickWrap = document.createElement("div");
    tickWrap.className = "tb-tick-wrap";
    right.append(marketWrap, tickWrap);

    body.append(left, right);
    panel.append(header, body);
    overlay.append(panel);

    updateActiveTab();

    chart = createPriceChart(chartWrap);
    marketListHandle = createMarketList(marketWrap, switchMarket);
    tickFeedHandle = createTickFeed(tickWrap, handleTick);

    if (investment.getMarkets().length > 0) {
      marketListHandle.setMarkets(investment.getMarkets());
      marketsLoaded = true;
    }
    marketListHandle.setSelected(market);
    tickFeedHandle.setMarket(market);
    renderHeader(investment.getTicker(market));
  }

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    overlay.classList.add("open");
    build();
    void loadCandles();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    chart?.destroy();
    marketListHandle?.destroy();
    tickFeedHandle?.destroy();
    chart = null;
    marketListHandle = null;
    tickFeedHandle = null;
    overlay.classList.remove("open");
    overlay.innerHTML = "";
    bus.emit(EV.TRADING_BOARD_CLOSED);
  }

  // ── bus / 입력 구독 ────────────────────────────────────────
  bus.on(EV.OPEN_TRADING_BOARD, open);

  // 3초마다 오는 전체 시세 갱신 — 마켓리스트/헤더에 반영 (열려 있을 때만)
  bus.on(EV.TICKERS, (map: Map<string, Ticker>) => {
    if (!isOpen) return;
    if (!marketsLoaded && investment.getMarkets().length > 0) {
      marketListHandle?.setMarkets(investment.getMarkets());
      marketsLoaded = true;
    }
    marketListHandle?.updateTickers(map);
    const t = map.get(market);
    if (t) renderHeader(t);
  });

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      // 이동/상호작용 키가 게임 캔버스로 새지 않게 차단 (검색 입력 등은 허용)
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
        if (document.activeElement?.tagName !== "INPUT") e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
}
