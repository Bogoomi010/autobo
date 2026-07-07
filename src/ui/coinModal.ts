/**
 * [파트 C] 코인 목록 오버레이 모달 (도트 감성).
 * EV.OPEN_COIN_MODAL 수신 시 열림 → 목록 화면 / 투자 확인 화면 전환.
 * 닫힘 시 반드시 EV.COIN_MODAL_CLOSED(invested) 를 정확히 1회 방송한다.
 */
import { sfx } from "../core/sfx";
import { STOP_LOSS_RATE, TAKE_PROFIT_RATE } from "../game/config";
import { bus, EV } from "../game/events";
import { coinPrice, krw, pct } from "../game/format";
import { store } from "../game/state";
import type { CoinInfo, Ticker } from "../game/types";
import { investment } from "../systems/InvestmentSystem";
import { makeBadge, signClass } from "./uiKit";

type Screen = "list" | "confirm";

export function initCoinModal(): void {
  const ui = document.getElementById("ui")!;

  // ── DOM 골격 ───────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "coinModal";

  const panel = document.createElement("div");
  panel.className = "cm-panel pixel-panel";

  // 헤더
  const head = document.createElement("div");
  head.className = "cm-head";
  const title = document.createElement("div");
  title.className = "cm-title";
  title.textContent = "📋 코인 시세판";
  const carry = document.createElement("div");
  carry.className = "cm-carry";
  head.append(title, carry);

  // 검색
  const search = document.createElement("input");
  search.id = "cmSearch";
  search.type = "text";
  search.placeholder = "코인명 · 심볼 검색";
  search.autocomplete = "off";

  // 목록
  const list = document.createElement("div");
  list.id = "cmList";

  // 투자 확인 화면
  const confirm = document.createElement("div");
  confirm.id = "cmConfirm";

  panel.append(head, search, list, confirm);
  overlay.append(panel);
  ui.append(overlay);

  // ── 상태 ───────────────────────────────────────────────────
  let isOpen = false;
  let invested = false; // 이번 세션 투자 성사 여부
  let screen: Screen = "list";
  let selected: CoinInfo | null = null;
  let orderInFlight = false; // 매수 주문 전송 중 — 모달 닫힘/중복 클릭 잠금
  /** market → 목록 행 (시세 갱신 시 값만 교체) */
  const rows = new Map<string, HTMLElement>();
  let listBuilt = false;

  // ── 열기/닫기 ──────────────────────────────────────────────
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    invested = false;
    overlay.classList.add("open");
    updateCarry();
    goList();
    buildOrRefreshList();
    search.value = "";
    // 자동 포커스는 게임 캔버스 입력과 충돌하지 않도록 살짝 지연
    setTimeout(() => search.focus(), 0);
  }

  /** 모달 종료 — COIN_MODAL_CLOSED 를 정확히 1회 방송 */
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    selected = null;
    overlay.classList.remove("open", "confirm");
    bus.emit(EV.COIN_MODAL_CLOSED, invested);
  }

  function goList(): void {
    screen = "list";
    selected = null;
    overlay.classList.remove("confirm");
  }

  function goConfirm(coin: CoinInfo): void {
    screen = "confirm";
    selected = coin;
    overlay.classList.add("confirm");
    renderConfirm();
  }

  function updateCarry(): void {
    carry.innerHTML = `지갑 <b class="num">${krw(store.carried)}</b>`;
  }

  // ── 목록 화면 ──────────────────────────────────────────────
  function buildOrRefreshList(): void {
    const markets = investment.getMarkets();
    if (markets.length === 0) {
      list.replaceChildren();
      rows.clear();
      listBuilt = false;
      const loading = document.createElement("div");
      loading.className = "cm-loading";
      loading.textContent = "시세 불러오는 중…";
      list.append(loading);
      return;
    }
    if (!listBuilt) rebuildList(markets);
    else refreshListValues();
    applySearch();
  }

  /** 전체 목록 재구성 (24h 거래대금 순 정렬) */
  function rebuildList(markets: CoinInfo[]): void {
    const sorted = [...markets].sort((a, b) => {
      const ta = investment.getTicker(a.market)?.accTradePrice24h ?? 0;
      const tb = investment.getTicker(b.market)?.accTradePrice24h ?? 0;
      return tb - ta;
    });
    list.replaceChildren();
    rows.clear();
    for (const coin of sorted) {
      const row = makeRow(coin);
      rows.set(coin.market, row);
      list.append(row);
    }
    listBuilt = true;
    refreshListValues();
  }

  function makeRow(coin: CoinInfo): HTMLElement {
    const row = document.createElement("button");
    row.className = "cm-row";
    row.dataset.market = coin.market;
    row.dataset.search = `${coin.nameKo} ${coin.symbol} ${coin.nameEn}`.toLowerCase();

    const badge = makeBadge(coin.symbol);
    const name = document.createElement("div");
    name.className = "cm-name";
    const ko = document.createElement("span");
    ko.className = "ko";
    ko.textContent = coin.nameKo;
    const sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = coin.symbol;
    name.append(ko, sym);

    const price = document.createElement("div");
    price.className = "cm-price";
    const p = document.createElement("span");
    p.className = "p num";
    const pc = document.createElement("span");
    pc.className = "pc num";
    price.append(p, pc);

    row.append(badge, name, price);
    row.addEventListener("click", () => goConfirm(coin));
    return row;
  }

  /** 목록의 현재가/등락률만 갱신 */
  function refreshListValues(): void {
    for (const [market, row] of rows) {
      const t = investment.getTicker(market);
      const p = row.querySelector<HTMLElement>(".p")!;
      const pc = row.querySelector<HTMLElement>(".pc")!;
      if (!t) {
        p.textContent = "—";
        pc.textContent = "";
        pc.className = "pc num";
        continue;
      }
      p.textContent = `₩${coinPrice(t.price)}`;
      pc.textContent = pct(t.changeRate24h);
      pc.className = `pc num ${signClass(t.changeRate24h)}`;
    }
  }

  function applySearch(): void {
    const q = search.value.trim().toLowerCase();
    for (const row of rows.values()) {
      const hit = q === "" || (row.dataset.search ?? "").includes(q);
      row.style.display = hit ? "" : "none";
    }
  }

  search.addEventListener("input", applySearch);

  // ── 투자 확인 화면 ─────────────────────────────────────────
  function renderConfirm(): void {
    if (!selected) return;
    const coin = selected;
    const t = investment.getTicker(coin.market);
    const price = t?.price ?? 0;
    const amount = store.carried;
    const qty = price > 0 ? amount / price : 0;
    const tp = Math.round(amount * (1 + TAKE_PROFIT_RATE));
    const sl = Math.round(amount * (1 + STOP_LOSS_RATE));
    const canInvest = amount > 0 && price > 0;

    confirm.replaceChildren();

    // 히어로 (뱃지 + 이름)
    const hero = document.createElement("div");
    hero.className = "cf-hero";
    const heroName = document.createElement("div");
    const hName = document.createElement("div");
    hName.className = "cf-h-name";
    hName.textContent = coin.nameKo;
    const hSym = document.createElement("div");
    hSym.className = "cf-h-sym";
    hSym.textContent = coin.symbol;
    heroName.append(hName, hSym);
    hero.append(makeBadge(coin.symbol), heroName);

    // 정보 라인들
    const info = document.createElement("div");
    info.className = "cf-rows";
    info.append(
      cfLine("현재가", `₩${coinPrice(price)}`),
      cfLine("투자금 (지갑 전액)", krw(amount)),
      cfLine("예상 수량", price > 0 ? `${qty.toFixed(6)} ${coin.symbol}` : "—")
    );

    // 목표가 미리보기
    const target = document.createElement("div");
    target.className = "cf-target";
    target.innerHTML =
      `<div><span class="up">+3% 익절</span> 시 → <b class="num">${krw(tp)}</b> 회수</div>` +
      `<div><span class="down">-3% 손절</span> 시 → <b class="num">${krw(sl)}</b> 회수</div>`;

    // 액션 버튼
    const actions = document.createElement("div");
    actions.className = "cf-actions";
    const back = document.createElement("button");
    back.className = "pixel-btn wood";
    back.textContent = "← 돌아가기";
    back.addEventListener("click", () => {
      if (orderInFlight) return; // 주문 중엔 이탈 금지
      goList();
      buildOrRefreshList();
    });
    const buy = document.createElement("button");
    buy.className = "pixel-btn";
    buy.textContent = "🪙 투자하기";
    buy.disabled = !canInvest;
    buy.addEventListener("click", () => void doInvest(coin, buy, back));
    actions.append(back, buy);

    confirm.append(hero, info, target);
    // 실거래 모드 경고 — 실제 계좌로 시장가 매수
    if (store.mode === "real") {
      const warn = document.createElement("div");
      warn.className = "cf-warn";
      warn.textContent = "⚠ 실제 업비트 계좌로 시장가 매수합니다";
      confirm.append(warn);
    }
    confirm.append(actions);
  }

  async function doInvest(
    coin: CoinInfo,
    buy: HTMLButtonElement,
    back: HTMLButtonElement
  ): Promise<void> {
    if (orderInFlight) return;
    // 투자 시점의 최신 시세를 진입가 힌트로 사용
    const t = investment.getTicker(coin.market);
    const price = t?.price ?? 0;

    // 주문 전송 중 — 버튼 잠금 + 라벨 변경 (실거래는 체결 확인까지 수 초)
    orderInFlight = true;
    const buyLabel = buy.textContent;
    buy.disabled = true;
    back.disabled = true;
    buy.textContent = "⏳ 주문 전송 중…";

    const ok = await store.invest(coin, price);

    orderInFlight = false;
    if (ok) {
      invested = true;
      sfx.power();
      close();
    } else {
      // 실패 — 버튼 복구 (모달 유지, 에러 토스트는 store가 처리)
      buy.disabled = false;
      back.disabled = false;
      buy.textContent = buyLabel;
    }
  }

  // ── bus / 입력 구독 ────────────────────────────────────────
  bus.on(EV.OPEN_COIN_MODAL, () => open());

  // 시세 갱신 — 목록이 열려 있을 때만 반영 (전체 리렌더 대신 값만)
  bus.on(EV.TICKERS, (_map: Map<string, Ticker>) => {
    if (!isOpen) return;
    if (screen === "list") buildOrRefreshList();
    else if (!orderInFlight) renderConfirm(); // 주문 중엔 버튼 상태 보존
  });

  // 지갑 변동 시 표시 갱신 (확인 화면 투자금 포함)
  bus.on(EV.CARRY, () => {
    if (!isOpen) return;
    updateCarry();
    if (screen === "confirm" && !orderInFlight) renderConfirm();
  });

  // 배경(오버레이) 클릭 = 닫기 (주문 중엔 잠금 — 체결 결과 놓침 방지)
  overlay.addEventListener("mousedown", (e) => {
    if (orderInFlight) return;
    if (e.target === overlay) close();
  });

  // 키 입력 — 모달이 열린 동안만. ESC=뒤로/닫기, 방향키·Space는 게임으로 누출 차단
  window.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen) return;
      if (orderInFlight) {
        // 주문 처리 중엔 모든 키 입력 무시 (체결 결과 놓침 방지)
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (screen === "confirm") {
          goList();
          buildOrRefreshList();
        } else {
          close();
        }
        return;
      }
      // 이동/상호작용 키가 캔버스로 새지 않게 차단 (검색 입력은 허용)
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
        if (document.activeElement !== search) e.preventDefault();
        e.stopPropagation();
      }
    },
    true // 캡처 단계 — 씬 핸들러보다 먼저
  );
}

/** 확인 화면 정보 라인 */
function cfLine(k: string, v: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "cf-line";
  const key = document.createElement("span");
  key.className = "k";
  key.textContent = k;
  const val = document.createElement("span");
  val.className = "num";
  val.textContent = v;
  line.append(key, val);
  return line;
}
