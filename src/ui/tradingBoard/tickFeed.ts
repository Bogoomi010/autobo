import type { TradeTick } from "../../game/types";
import { fetchRecentTrades } from "../../api/upbit";

/** 체결(틱) 피드 컴포넌트 핸들 */
export interface TickFeed {
  setMarket(market: string): void;
  destroy(): void;
}

const STYLE_ID = "tick-feed-style";
/** 폴링 주기 — 업비트 rate limit(초당 10회/IP) 고려 */
const POLL_INTERVAL_MS = 1000;
/** 화면에 유지할 최대 체결 행 수 */
const MAX_ROWS = 50;
/** 매 폴링마다 가져올 체결 개수(백필 포함) */
const FETCH_COUNT = 20;

/** 스타일 태그를 한 번만 주입 — 모달이 여러 번 열려도 중복 삽입 방지 */
function injectStyleOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .tick-feed {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #ffffff;
      border: 1px solid #ebeef1;
      color: #1e2329;
      font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      overflow-y: auto;
    }
    .tick-feed-title {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 8px 10px;
      font-weight: 700;
      background: #f9fafb;
      border-bottom: 1px solid #ebeef1;
    }
    .tick-feed-header {
      position: sticky;
      top: 29px;
      z-index: 2;
      display: grid;
      grid-template-columns: 62px 1fr 64px 40px;
      gap: 4px;
      padding: 6px 10px;
      background: #f9fafb;
      border-bottom: 1px solid #ebeef1;
      color: #8b95a1;
      font-size: 11px;
    }
    .tick-feed-header span:nth-child(1) { text-align: left; }
    .tick-feed-header span:nth-child(2) { text-align: right; }
    .tick-feed-header span:nth-child(3) { text-align: right; }
    .tick-feed-header span:nth-child(4) { text-align: center; }
    .tick-feed-body {
      display: flex;
      flex-direction: column;
    }
    .tick-feed-row {
      display: grid;
      grid-template-columns: 62px 1fr 64px 40px;
      gap: 4px;
      padding: 4px 10px;
      border-bottom: 1px solid #ebeef1;
      font-variant-numeric: tabular-nums;
    }
    .tick-feed-row.bid { background: rgba(210, 79, 69, 0.07); }
    .tick-feed-row.ask { background: rgba(18, 97, 196, 0.07); }
    .tick-feed-row .time { text-align: left; color: #8b95a1; }
    .tick-feed-row .price { text-align: right; font-weight: 600; }
    .tick-feed-row .volume { text-align: right; color: #1e2329; }
    .tick-feed-row .side { text-align: center; font-weight: 600; }
    .tick-feed-row.bid .price, .tick-feed-row.bid .side { color: #d24f45; }
    .tick-feed-row.ask .price, .tick-feed-row.ask .side { color: #1261c4; }
  `;
  document.head.appendChild(style);
}

/** 체결 시각(ms)을 HH:MM:SS 형식으로 변환 */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 체결가를 자릿수에 따라 동적 포맷(1000원 이상 정수, 1~1000원 소수 2자리, 1원 미만 소수 4자리) */
function formatPrice(price: number): string {
  if (price >= 1000) return Math.round(price).toLocaleString("ko-KR");
  if (price >= 1) {
    return price.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return price.toLocaleString("ko-KR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/** 체결 수량 포맷 — 소수 4자리로 고정(너무 길어지지 않게) */
function formatVolume(volume: number): string {
  return volume.toFixed(4);
}

/** 체결 한 건을 표시할 행 DOM 생성 */
function buildRowEl(tick: TradeTick): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `tick-feed-row ${tick.side}`;

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = formatTime(tick.time);

  const price = document.createElement("span");
  price.className = "price";
  price.textContent = formatPrice(tick.price);

  const volume = document.createElement("span");
  volume.className = "volume";
  volume.textContent = formatVolume(tick.volume);

  const side = document.createElement("span");
  side.className = "side";
  side.textContent = tick.side === "bid" ? "매수" : "매도";

  row.append(time, price, volume, side);
  return row;
}

/**
 * 선택된 코인의 실시간 개별 체결(틱)을 스크롤 리스트로 보여주는 컴포넌트를 생성한다.
 * onTick은 최초 백필 이후 새로 발견된 체결에 대해서만(오래된 순서로) 호출된다.
 */
export function createTickFeed(
  container: HTMLElement,
  onTick?: (tick: TradeTick) => void
): TickFeed {
  injectStyleOnce();

  container.classList.add("tick-feed");

  const title = document.createElement("div");
  title.className = "tick-feed-title";
  title.textContent = "체결";

  const header = document.createElement("div");
  header.className = "tick-feed-header";
  header.innerHTML = "<span>체결시간</span><span>체결가격(KRW)</span><span>체결량(BTC)</span><span>구분</span>";

  const body = document.createElement("div");
  body.className = "tick-feed-body";

  container.append(title, header, body);

  let currentMarket = "";
  /** setMarket이 호출될 때마다 증가 — 이전 마켓의 늦게 도착한 폴링 결과를 무시하기 위한 토큰 */
  let token = 0;
  let seenIds = new Set<string>();
  let isBackfill = true;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  function clearTimer(): void {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  }

  async function poll(myToken: number): Promise<void> {
    let ticks: TradeTick[];
    try {
      ticks = await fetchRecentTrades(currentMarket, FETCH_COUNT);
    } catch {
      return; // 네트워크 실패 시 조용히 다음 폴링에서 재시도
    }
    if (myToken !== token) return; // 그 사이 마켓이 바뀜 — 이 결과는 버린다

    // 업비트 응답은 최신순 → 오래된 순으로 뒤집어 신규 여부를 오래된 것부터 판별
    const ascending = [...ticks].reverse();
    const freshTicks: TradeTick[] = [];
    for (const tick of ascending) {
      if (seenIds.has(tick.id)) continue;
      seenIds.add(tick.id);
      freshTicks.push(tick);
    }

    if (isBackfill) {
      // 백필: onTick 호출 없이 최신이 위로 오도록 역순으로 렌더링만 한다
      for (const tick of [...freshTicks].reverse()) {
        body.appendChild(buildRowEl(tick));
      }
      isBackfill = false;
    } else {
      // 오래된 것부터 맨 위에 삽입 → 최종적으로 최신이 가장 위, onTick도 오래된 순으로 호출
      for (const tick of freshTicks) {
        body.insertBefore(buildRowEl(tick), body.firstChild);
        onTick?.(tick);
      }
    }

    while (body.childElementCount > MAX_ROWS) {
      const last = body.lastElementChild;
      if (!last) break;
      body.removeChild(last);
    }
  }

  return {
    setMarket(market: string): void {
      currentMarket = market;
      token += 1;
      const myToken = token;
      seenIds = new Set();
      isBackfill = true;
      body.innerHTML = "";
      clearTimer();
      void poll(myToken);
      intervalId = setInterval(() => {
        void poll(myToken);
      }, POLL_INTERVAL_MS);
    },
    destroy(): void {
      clearTimer();
    },
  };
}
