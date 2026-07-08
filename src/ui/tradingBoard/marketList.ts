/**
 * [트레이딩 보드] 우측 "원화 마켓" 코인 목록 패널.
 * 실제 업비트 웹사이트처럼 검색/정렬 가능한 표 형태로 전체 KRW 마켓을 보여준다.
 * updateTickers는 3초마다 호출될 예정이므로 행을 새로 만들지 않고 셀 텍스트만 교체한다.
 */
import { coinPrice, pct } from "../../game/format";
import type { CoinInfo, Ticker } from "../../game/types";
import { badgeColor } from "../uiKit";

export interface MarketList {
  setMarkets(markets: CoinInfo[]): void;
  updateTickers(tickers: Map<string, Ticker>): void;
  setSelected(market: string): void;
  destroy(): void;
}

/** 정렬 가능한 컬럼 키 (favorite 컬럼은 정렬 대상이 아님) */
type SortKey = "koreanName" | "tradePrice" | "signedChangeRate" | "accTradeValue24h";

/** 한 코인 행이 들고 있는 DOM 참조 — updateTickers 시 재사용 */
interface RowRefs {
  coin: CoinInfo;
  el: HTMLDivElement;
  favEl: HTMLSpanElement;
  priceEl: HTMLSpanElement;
  changeEl: HTMLSpanElement;
  volumeEl: HTMLSpanElement;
  favorite: boolean;
}

const STYLE_ID = "market-list-styles";

/** 거래대금(KRW) → "1,234백만" 축약 표기 */
function formatAccValue(v: number): string {
  const millions = Math.round(v / 1_000_000);
  return `${millions.toLocaleString("ko-KR")}백만`;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ml-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f7ecd4;
  font-family: "Galmuri11", "Malgun Gothic", sans-serif;
  color: #3d2a1a;
  box-sizing: border-box;
  min-height: 0;
}
.ml-title {
  flex: none;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #3d2a1a;
  background: #f2b135;
  border-bottom: 3px solid #3d2a1a;
}
.ml-search-wrap {
  flex: none;
  padding: 8px 10px;
  background: #efe0c0;
  border-bottom: 3px solid #3d2a1a;
}
.ml-search {
  width: 100%;
  box-sizing: border-box;
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  border: 2px solid #3d2a1a;
  border-radius: 2px;
  outline: none;
  color: #3d2a1a;
  background: #ffffff;
  font-family: inherit;
}
.ml-search:focus {
  border-color: #2fbf9b;
}
.ml-grid {
  display: grid;
  grid-template-columns: 24px 1fr 74px 60px 72px;
  align-items: center;
}
.ml-header {
  flex: none;
  padding: 0 10px;
  height: 26px;
  background: #efe0c0;
  border-bottom: 2px solid #3d2a1a;
  font-size: 11px;
  color: #8a5a33;
}
.ml-header .ml-th {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ml-header .ml-th.active {
  color: #3d2a1a;
  font-weight: 700;
}
.ml-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.ml-loading {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: #8a5a33;
}
.ml-row {
  padding: 0 10px;
  height: 28px;
  font-size: 12px;
  border-bottom: 1px solid rgba(61, 42, 26, 0.15);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.ml-row:hover {
  background: #efe0c0;
}
.ml-row.selected {
  background: rgba(47, 191, 155, 0.22);
}
.ml-row.hidden {
  display: none;
}
.ml-fav {
  text-align: center;
  color: #c9b892;
  font-size: 13px;
  line-height: 1;
}
.ml-fav.active {
  color: #f2b135;
}
.ml-name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.ml-badge {
  flex: none;
  width: 18px;
  height: 18px;
  border: 2px solid #3d2a1a;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  color: #3d2a1a;
}
.ml-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ml-cell-right {
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ml-up { color: #e5484d; }
.ml-down { color: #3b82f6; }
`;
  document.head.appendChild(style);
}

/** 원화 마켓 코인 목록 패널 생성 — container 는 상위(board.ts)가 크기를 결정한다 */
export function createMarketList(
  container: HTMLElement,
  onSelect: (market: string) => void
): MarketList {
  injectStyles();

  let markets: CoinInfo[] = [];
  const tickers = new Map<string, Ticker>();
  const rows = new Map<string, RowRefs>();
  let selectedMarket: string | null = null;
  let searchQuery = "";
  let sortKey: SortKey = "accTradeValue24h";
  let sortDir: 1 | -1 = -1;

  const root = document.createElement("div");
  root.className = "ml-root";

  const title = document.createElement("div");
  title.className = "ml-title";
  title.textContent = "원화 마켓";

  const searchWrap = document.createElement("div");
  searchWrap.className = "ml-search-wrap";
  const searchInput = document.createElement("input");
  searchInput.className = "ml-search";
  searchInput.type = "text";
  searchInput.placeholder = "코인명/심볼 검색";
  searchInput.autocomplete = "off";
  searchWrap.appendChild(searchInput);

  const columns: { key: SortKey | "favorite"; label: string }[] = [
    { key: "favorite", label: "" },
    { key: "koreanName", label: "한글명" },
    { key: "tradePrice", label: "현재가" },
    { key: "signedChangeRate", label: "전일대비" },
    { key: "accTradeValue24h", label: "거래대금" },
  ];

  const header = document.createElement("div");
  header.className = "ml-grid ml-header";
  const headerCells = new Map<SortKey, HTMLDivElement>();
  for (const col of columns) {
    const cell = document.createElement("div");
    cell.className = col.key === "koreanName" ? "ml-th" : "ml-th ml-cell-right";
    if (col.key === "favorite") cell.className = "ml-th ml-fav";
    cell.textContent = col.label;
    if (col.key !== "favorite") {
      const key = col.key;
      headerCells.set(key, cell);
      cell.addEventListener("click", () => {
        if (sortKey === key) {
          sortDir = sortDir === 1 ? -1 : 1;
        } else {
          sortKey = key;
          sortDir = key === "koreanName" ? 1 : -1;
        }
        updateHeaderActive();
        reorderRows();
      });
    }
    header.appendChild(cell);
  }

  function updateHeaderActive(): void {
    headerCells.forEach((cell, key) => {
      cell.classList.toggle("active", key === sortKey);
    });
  }

  const loading = document.createElement("div");
  loading.className = "ml-loading";
  loading.textContent = "시세 불러오는 중…";

  const body = document.createElement("div");
  body.className = "ml-body";
  body.appendChild(loading);

  root.append(title, searchWrap, header, body);
  container.innerHTML = "";
  container.appendChild(root);

  /** 검색어와 코인 정보가 일치하는지 */
  function matchesSearch(coin: CoinInfo): boolean {
    if (!searchQuery) return true;
    return (
      coin.nameKo.toLowerCase().includes(searchQuery) ||
      coin.symbol.toLowerCase().includes(searchQuery)
    );
  }

  /** 현재 정렬 키·방향 기준 비교자 */
  function compareRows(a: CoinInfo, b: CoinInfo): number {
    if (sortKey === "koreanName") {
      return a.nameKo.localeCompare(b.nameKo, "ko") * sortDir;
    }
    const ta = tickers.get(a.market);
    const tb = tickers.get(b.market);
    const va = ta ? (sortKey === "tradePrice" ? ta.price : sortKey === "signedChangeRate" ? ta.changeRate24h : ta.accTradePrice24h) : 0;
    const vb = tb ? (sortKey === "tradePrice" ? tb.price : sortKey === "signedChangeRate" ? tb.changeRate24h : tb.accTradePrice24h) : 0;
    return (va - vb) * sortDir;
  }

  /** 정렬 순서대로 기존 행 엘리먼트를 재배치(재생성 아님) */
  function reorderRows(): void {
    const ordered = [...markets].sort(compareRows);
    for (const coin of ordered) {
      const row = rows.get(coin.market);
      if (row) body.appendChild(row.el);
    }
  }

  function applyFilter(): void {
    rows.forEach((row) => {
      row.el.classList.toggle("hidden", !matchesSearch(row.coin));
    });
  }

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    applyFilter();
  });

  /** 티커 값으로 행의 현재가/전일대비/거래대금 셀 텍스트·색을 갱신 */
  function applyTickerToRow(row: RowRefs, ticker: Ticker): void {
    row.priceEl.textContent = coinPrice(ticker.price);
    row.changeEl.textContent = pct(ticker.changeRate24h);
    row.volumeEl.textContent = formatAccValue(ticker.accTradePrice24h);
    const cls = ticker.changeRate24h > 0 ? "ml-up" : ticker.changeRate24h < 0 ? "ml-down" : "";
    row.priceEl.className = `ml-cell-right ${cls}`;
    row.changeEl.className = `ml-cell-right ${cls}`;
  }

  /** markets 전체로부터 행 DOM을 새로 구성 */
  function buildRows(): void {
    body.innerHTML = "";
    rows.clear();

    if (markets.length === 0) {
      body.appendChild(loading);
      return;
    }

    const ordered = [...markets].sort(compareRows);
    for (const coin of ordered) {
      const el = document.createElement("div");
      el.className = "ml-grid ml-row";
      el.addEventListener("click", () => onSelect(coin.market));

      const favEl = document.createElement("span");
      favEl.className = "ml-fav";
      favEl.textContent = "★";
      favEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const row = rows.get(coin.market);
        if (!row) return;
        row.favorite = !row.favorite;
        favEl.classList.toggle("active", row.favorite);
      });

      const nameCell = document.createElement("div");
      nameCell.className = "ml-name-cell";
      const badge = document.createElement("div");
      badge.className = "ml-badge";
      badge.style.background = badgeColor(coin.symbol);
      badge.textContent = coin.symbol.slice(0, coin.symbol.length >= 4 ? 2 : coin.symbol.length).toUpperCase();
      const nameText = document.createElement("span");
      nameText.className = "ml-name-text";
      nameText.textContent = coin.nameKo;
      nameCell.append(badge, nameText);

      const priceEl = document.createElement("span");
      priceEl.className = "ml-cell-right";
      priceEl.textContent = "-";

      const changeEl = document.createElement("span");
      changeEl.className = "ml-cell-right";
      changeEl.textContent = "-";

      const volumeEl = document.createElement("span");
      volumeEl.className = "ml-cell-right";
      volumeEl.textContent = "-";

      el.append(favEl, nameCell, priceEl, changeEl, volumeEl);
      body.appendChild(el);

      const row: RowRefs = { coin, el, favEl, priceEl, changeEl, volumeEl, favorite: false };
      rows.set(coin.market, row);

      const ticker = tickers.get(coin.market);
      if (ticker) applyTickerToRow(row, ticker);
      if (coin.market === selectedMarket) el.classList.add("selected");
    }

    applyFilter();
  }

  updateHeaderActive();

  return {
    setMarkets(next: CoinInfo[]): void {
      markets = next;
      buildRows();
    },
    updateTickers(next: Map<string, Ticker>): void {
      next.forEach((ticker, market) => {
        tickers.set(market, ticker);
        const row = rows.get(market);
        if (row) applyTickerToRow(row, ticker);
      });
      reorderRows();
    },
    setSelected(market: string): void {
      selectedMarket = market;
      rows.forEach((row, key) => {
        row.el.classList.toggle("selected", key === market);
      });
    },
    destroy(): void {
      root.remove();
      rows.clear();
    },
  };
}
