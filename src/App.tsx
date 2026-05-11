import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  KeyRound,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Wallet,
} from "lucide-react";
import "./App.css";

type ApiKeys = {
  accessKey: string;
  secretKey: string;
};

type OrderRequest = {
  market: string;
  side: "bid" | "ask";
  volume?: string | null;
  price?: string | null;
  ord_type: "limit" | "price" | "market" | "best";
  identifier?: string | null;
  time_in_force?: string | null;
};

type Ticker = {
  market: string;
  trade_price: number;
  signed_change_price: number;
  signed_change_rate: number;
  acc_trade_price_24h: number;
};

type AssetAccount = {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
  avg_buy_price_modified?: boolean;
  unit_currency: string;
};

type MarketInfo = {
  market: string;
  korean_name: string;
  english_name: string;
  market_warning?: string;
  market_event?: {
    warning?: boolean;
    caution?: Record<string, boolean>;
  };
};

type CandleApiResponse = {
  market: string;
  candle_date_time_utc: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
};

type ChartCandle = CandlestickData<UTCTimestamp>;

type ChartTimeframe =
  | "seconds"
  | "1m"
  | "3m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "60m"
  | "240m"
  | "1d"
  | "1w"
  | "1mo"
  | "1y";

type MarketFilter = "KRW" | "BTC" | "USDT" | "ALL";

type LogEntry = {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  at: string;
};

const marketFilters: { value: MarketFilter; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "KRW", label: "KRW" },
  { value: "BTC", label: "BTC" },
  { value: "USDT", label: "USDT" },
];

const chartTimeframes: { value: ChartTimeframe; label: string }[] = [
  { value: "seconds", label: "초" },
  { value: "1m", label: "1분" },
  { value: "3m", label: "3분" },
  { value: "5m", label: "5분" },
  { value: "10m", label: "10분" },
  { value: "15m", label: "15분" },
  { value: "30m", label: "30분" },
  { value: "60m", label: "1시간" },
  { value: "240m", label: "4시간" },
  { value: "1d", label: "일" },
  { value: "1w", label: "주" },
  { value: "1mo", label: "월" },
  { value: "1y", label: "년" },
];

const numberFormat = new Intl.NumberFormat("ko-KR");
const percentFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const ASSET_WINDOW_LABEL = "asset";

function tauriKeys(keys: ApiKeys) {
  return {
    access_key: keys.accessKey.trim(),
    secret_key: keys.secretKey.trim(),
  };
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function nowText() {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function isMarketCode(value: string) {
  return /^[A-Z]+-[A-Z0-9]+$/.test(value);
}

function toChartCandle(candle: CandleApiResponse): ChartCandle | null {
  const timestamp = Date.parse(`${candle.candle_date_time_utc}Z`);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return {
    time: Math.floor(timestamp / 1000) as UTCTimestamp,
    open: candle.opening_price,
    high: candle.high_price,
    low: candle.low_price,
    close: candle.trade_price,
  };
}

function formatAssetNumber(value: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return value || "-";
  }

  return numberValue.toLocaleString("ko-KR", {
    maximumFractionDigits: 8,
  });
}

function AssetWindow() {
  const [accounts, setAccounts] = useState<AssetAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await invoke<AssetAccount[]>("get_session_accounts");
      setAccounts(Array.isArray(response) ? response : []);
    } catch (nextError) {
      setAccounts([]);
      setError(String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("asset-window-body");
    return () => document.body.classList.remove("asset-window-body");
  }, []);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    WebviewWindow.getCurrent()
      .listen("asset-session-updated", () => {
        refreshAccounts();
      })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      });

    return () => {
      unlisten?.();
    };
  }, [refreshAccounts]);

  return (
    <main className="asset-shell">
      <section className="asset-header panel">
        <div>
          <span className="eyebrow">Upbit Account</span>
          <h1>자산</h1>
        </div>
        <button className="secondary-button" type="button" disabled={loading} onClick={refreshAccounts}>
          <RefreshCw size={17} />
          새로고침
        </button>
      </section>

      <section className="panel asset-panel">
        {error ? <div className="state-box error">{error}</div> : null}
        {!error && loading && accounts.length === 0 ? <div className="state-box">자산 정보를 불러오는 중입니다.</div> : null}
        {!error && !loading && accounts.length === 0 ? <div className="state-box">표시할 자산 정보가 없습니다.</div> : null}
        {!error && accounts.length > 0 ? (
          <div className="asset-table-wrap">
            <table className="asset-table">
              <thead>
                <tr>
                  <th>통화</th>
                  <th>보유 수량</th>
                  <th>주문 중 수량</th>
                  <th>평균 매수가</th>
                  <th>평가 기준 통화</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={`${account.currency}-${account.unit_currency}`}>
                    <td className="asset-currency">{account.currency}</td>
                    <td>{formatAssetNumber(account.balance)}</td>
                    <td>{formatAssetNumber(account.locked)}</td>
                    <td>{formatAssetNumber(account.avg_buy_price)}</td>
                    <td>{account.unit_currency || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function App() {
  if (window.location.hash === "#/assets") {
    return <AssetWindow />;
  }

  const [keys, setKeys] = useState<ApiKeys>({ accessKey: "", secretKey: "" });
  const [market, setMarket] = useState("KRW-BTC");
  const [dryRun, setDryRun] = useState(true);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [accounts, setAccounts] = useState<unknown>(null);
  const [chance, setChance] = useState<unknown>(null);
  const [lastOrder, setLastOrder] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const lastTradeAtRef = useRef(0);
  const logIdRef = useRef(1);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("ALL");
  const [marketSearch, setMarketSearch] = useState("");
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("5m");
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState({
    intervalSec: "10",
    buyBelow: "",
    buyKrw: "10000",
    sellAbove: "",
    sellVolume: "",
    cooldownSec: "60",
  });

  const [manualOrder, setManualOrder] = useState<OrderRequest>({
    market: "KRW-BTC",
    side: "bid",
    volume: "",
    price: "",
    ord_type: "limit",
    identifier: "",
    time_in_force: "",
  });

  const isKeyReady = keys.accessKey.trim() !== "" && keys.secretKey.trim() !== "";
  const normalizedMarket = market.trim().toUpperCase();
  const selectedMarketInfo = useMemo(
    () => markets.find((item) => item.market === normalizedMarket) ?? null,
    [markets, normalizedMarket],
  );
  const selectedTimeframeLabel = useMemo(
    () => chartTimeframes.find((item) => item.value === chartTimeframe)?.label ?? chartTimeframe,
    [chartTimeframe],
  );
  const hasSelectedMarketWarning =
    selectedMarketInfo?.market_warning === "CAUTION" || selectedMarketInfo?.market_event?.warning === true;
  const filteredMarkets = useMemo(() => {
    const search = marketSearch.trim().toLowerCase();

    return markets.filter((item) => {
      const quoteCurrency = item.market.split("-")[0];
      const matchesFilter = marketFilter === "ALL" || quoteCurrency === marketFilter;
      const matchesSearch =
        search === "" ||
        item.market.toLowerCase().includes(search) ||
        item.korean_name.toLowerCase().includes(search) ||
        item.english_name.toLowerCase().includes(search);

      return matchesFilter && matchesSearch;
    });
  }, [marketFilter, marketSearch, markets]);

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    const next: LogEntry = {
      id: logIdRef.current++,
      level,
      message,
      at: nowText(),
    };
    setLogs((current) => [next, ...current].slice(0, 80));
  }, []);

  const refreshMarkets = useCallback(async () => {
    setMarketsLoading(true);
    setMarketsError(null);
    try {
      const response = await invoke<MarketInfo[]>("get_markets", {
        isDetails: true,
      });
      setMarkets(response);

      const fallbackMarket =
        response.find((item) => item.market === "KRW-BTC") ??
        response.find((item) => item.market.startsWith("KRW-")) ??
        response[0];

      setMarket((current) => {
        const currentMarket = current.trim().toUpperCase();
        if (response.some((item) => item.market === currentMarket)) {
          return currentMarket;
        }

        return fallbackMarket?.market ?? (currentMarket || "KRW-BTC");
      });
    } catch (error) {
      const message = String(error);
      setMarketsError(message);
      addLog("error", message);
    } finally {
      setMarketsLoading(false);
    }
  }, [addLog]);

  const refreshCandles = useCallback(async () => {
    if (!isMarketCode(normalizedMarket)) {
      setCandles([]);
      setChartError("마켓 코드를 선택하거나 입력하세요. 예: KRW-BTC");
      setChartLoading(false);
      return;
    }

    setChartLoading(true);
    setChartError(null);
    try {
      const response = await invoke<CandleApiResponse[]>("get_candles", {
        market: normalizedMarket,
        timeframe: chartTimeframe,
        count: 100,
      });
      const nextCandles = response
        .map(toChartCandle)
        .filter((candle): candle is ChartCandle => candle !== null)
        .sort((a, b) => Number(a.time) - Number(b.time));
      setCandles(nextCandles);
    } catch (error) {
      const message = String(error);
      setCandles([]);
      setChartError(message);
      addLog("error", message);
    } finally {
      setChartLoading(false);
    }
  }, [addLog, chartTimeframe, normalizedMarket]);

  const invokeOrder = useCallback(
    async (order: OrderRequest) => {
      const result = await invoke("place_order", {
        keys: tauriKeys(keys),
        order,
        dryRun,
      });
      setLastOrder(result);
      addLog(
        dryRun ? "warn" : "info",
        `${dryRun ? "모의" : "실거래"} 주문 처리: ${order.side}/${order.ord_type} ${order.market}`,
      );
      return result;
    },
    [addLog, dryRun, keys],
  );

  const refreshTicker = useCallback(async () => {
    const response = await invoke<Ticker[]>("get_ticker", {
      markets: normalizedMarket,
    });
    const nextTicker = response[0];
    setTicker(nextTicker);
    return nextTicker;
  }, [normalizedMarket]);

  const refreshPrivateData = useCallback(async () => {
    if (!isKeyReady) {
      addLog("warn", "잔고 조회에는 API Key가 필요합니다.");
      return;
    }

    const [nextAccounts, nextChance] = await Promise.all([
      invoke("get_accounts", { keys: tauriKeys(keys) }),
      invoke("get_order_chance", {
        keys: tauriKeys(keys),
        market: normalizedMarket,
      }),
    ]);
    setAccounts(nextAccounts);
    setChance(nextChance);
    addLog("info", "잔고와 주문 가능정보를 갱신했습니다.");
  }, [addLog, isKeyReady, keys, normalizedMarket]);

  const checkStrategy = useCallback(
    async (nextTicker: Ticker) => {
      if (!running) {
        return;
      }

      const price = Number(nextTicker.trade_price);
      const buyBelow = Number(strategy.buyBelow);
      const sellAbove = Number(strategy.sellAbove);
      const cooldownMs = Math.max(Number(strategy.cooldownSec) || 0, 1) * 1000;
      const elapsed = Date.now() - lastTradeAtRef.current;

      if (elapsed < cooldownMs) {
        return;
      }

      if (strategy.buyBelow.trim() !== "" && price <= buyBelow) {
        lastTradeAtRef.current = Date.now();
        await invokeOrder({
          market: normalizedMarket,
          side: "bid",
          price: strategy.buyKrw,
          ord_type: "price",
        });
        return;
      }

      if (strategy.sellAbove.trim() !== "" && price >= sellAbove) {
        if (strategy.sellVolume.trim() === "") {
          addLog("warn", "매도 조건은 충족됐지만 매도 수량이 비어 있습니다.");
          return;
        }

        lastTradeAtRef.current = Date.now();
        await invokeOrder({
          market: normalizedMarket,
          side: "ask",
          volume: strategy.sellVolume,
          ord_type: "market",
        });
      }
    },
    [addLog, invokeOrder, normalizedMarket, running, strategy],
  );

  const refreshAll = useCallback(async () => {
    setBusy(true);
    try {
      const nextTicker = await refreshTicker();
      await checkStrategy(nextTicker);
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }, [addLog, checkStrategy, refreshTicker]);

  useEffect(() => {
    setManualOrder((current) => ({ ...current, market: normalizedMarket }));
  }, [normalizedMarket]);

  useEffect(() => {
    refreshMarkets();
  }, [refreshMarkets]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) {
      return;
    }

    const chart = createChart(container, {
      autoSize: true,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#4d5c66",
      },
      grid: {
        vertLines: { color: "#eef2f5" },
        horzLines: { color: "#eef2f5" },
      },
      rightPriceScale: {
        borderColor: "#d8e0e6",
      },
      timeScale: {
        borderColor: "#d8e0e6",
        timeVisible: true,
        secondsVisible: true,
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#c43d34",
      downColor: "#1d62a7",
      borderVisible: false,
      wickUpColor: "#c43d34",
      wickDownColor: "#1d62a7",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    candleSeriesRef.current?.setData(candles);
    if (candles.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles]);

  useEffect(() => {
    refreshCandles();
  }, [refreshCandles]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!running) {
      return;
    }

    const intervalSec = Math.max(Number(strategy.intervalSec) || 10, 3);
    const timer = window.setInterval(refreshAll, intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [refreshAll, running, strategy.intervalSec]);

  const headline = useMemo(() => {
    if (!ticker) {
      return "시세 대기";
    }

    return `${numberFormat.format(ticker.trade_price)} KRW`;
  }, [ticker]);

  async function handleRefreshPrivateData() {
    setBusy(true);
    try {
      await refreshPrivateData();
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenAssetWindow() {
    if (!isKeyReady) {
      addLog("warn", "자산 창을 열려면 API Key가 필요합니다.");
      return;
    }

    setBusy(true);
    try {
      await invoke("set_session_api_keys", {
        keys: tauriKeys(keys),
      });

      const existingWindow = await WebviewWindow.getByLabel(ASSET_WINDOW_LABEL);
      if (existingWindow) {
        await existingWindow.emit("asset-session-updated", null);
        await existingWindow.show();
        await existingWindow.setFocus();
      } else {
        const assetWindow = new WebviewWindow(ASSET_WINDOW_LABEL, {
          url: "/#/assets",
          title: "Autobo 자산",
          width: 760,
          height: 560,
          minWidth: 620,
          minHeight: 420,
          focus: true,
        });
        assetWindow.once("tauri://error", (event) => {
          addLog("error", `자산 창 생성 실패: ${String(event.payload)}`);
        });
      }

      addLog("info", "자산 창을 열었습니다.");
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleManualOrder() {
    setBusy(true);
    try {
      await invokeOrder({
        ...manualOrder,
        market: manualOrder.market.trim().toUpperCase(),
        volume: manualOrder.volume?.trim() || null,
        price: manualOrder.price?.trim() || null,
        identifier: manualOrder.identifier?.trim() || null,
        time_in_force: manualOrder.time_in_force?.trim() || null,
      });
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <span className="eyebrow">Upbit Desktop Trader</span>
          <h1>Autobo</h1>
        </div>
        <div className="status-strip">
          <span className={dryRun ? "pill warning" : "pill danger"}>
            {dryRun ? "모의 실행" : "실거래"}
          </span>
          <span className={running ? "pill active" : "pill"}>{running ? "자동 감시 중" : "정지"}</span>
        </div>
      </section>

      <section className="market-band">
        <div className="quote">
          <label htmlFor="market">마켓</label>
          <input
            id="market"
            value={market}
            onChange={(event) => setMarket(event.currentTarget.value)}
            onBlur={() => setMarket((value) => value.trim().toUpperCase() || "KRW-BTC")}
          />
        </div>
        <div className="price-tile">
          <span>현재가</span>
          <strong>{headline}</strong>
          {ticker ? (
            <em className={ticker.signed_change_price >= 0 ? "up" : "down"}>
              {ticker.signed_change_price >= 0 ? "+" : ""}
              {numberFormat.format(ticker.signed_change_price)} ({percentFormat.format(ticker.signed_change_rate * 100)}%)
            </em>
          ) : (
            <em>조회 전</em>
          )}
        </div>
        <div className="price-tile">
          <span>24h 거래대금</span>
          <strong>{ticker ? `${numberFormat.format(Math.round(ticker.acc_trade_price_24h))} KRW` : "-"}</strong>
        </div>
        <button className="icon-button" type="button" disabled={busy} onClick={refreshAll}>
          <RefreshCw size={18} />
          갱신
        </button>
      </section>

      <section className="market-chart-grid">
        <article className="panel market-list-panel">
          <div className="panel-title">
            <BarChart3 size={18} />
            <h2>마켓 목록</h2>
          </div>
          <label>
            종목 검색
            <input
              value={marketSearch}
              placeholder="코드, 한글명, 영문명"
              onChange={(event) => setMarketSearch(event.currentTarget.value)}
            />
          </label>
          <div className="segmented-control" aria-label="마켓 필터">
            {marketFilters.map((item) => (
              <button
                className={marketFilter === item.value ? "selected" : ""}
                key={item.value}
                type="button"
                aria-pressed={marketFilter === item.value}
                onClick={() => setMarketFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="market-list-meta">
            <span>{marketsLoading ? "불러오는 중" : `${filteredMarkets.length} / ${markets.length}개`}</span>
            <button className="text-button" type="button" disabled={marketsLoading} onClick={refreshMarkets}>
              <RefreshCw size={15} />
              새로고침
            </button>
          </div>
          <div className="market-list">
            {marketsError ? (
              <div className="state-box error">{marketsError}</div>
            ) : marketsLoading && markets.length === 0 ? (
              <div className="state-box">마켓 목록을 불러오는 중입니다.</div>
            ) : filteredMarkets.length === 0 ? (
              <div className="state-box">조건에 맞는 종목이 없습니다.</div>
            ) : (
              filteredMarkets.map((item) => (
                <button
                  className={`market-row ${item.market === normalizedMarket ? "selected" : ""}`}
                  key={item.market}
                  type="button"
                  onClick={() => setMarket(item.market)}
                >
                  <span>
                    <strong>{item.korean_name}</strong>
                    <em>{item.english_name}</em>
                  </span>
                  <code>{item.market}</code>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel chart-panel">
          <div className="chart-panel-header">
            <div className="panel-title">
              <BarChart3 size={18} />
              <h2>{selectedMarketInfo?.korean_name ?? normalizedMarket}</h2>
            </div>
            <div className="chart-heading-meta">
              <span>{selectedMarketInfo?.english_name ?? "선택 종목"}</span>
              {hasSelectedMarketWarning ? <span className="pill warning">주의</span> : null}
              <code>{normalizedMarket}</code>
            </div>
          </div>
          <div className="chart-toolbar">
            <div className="timeframe-buttons" aria-label="차트 주기">
              {chartTimeframes.map((item) => (
                <button
                  className={chartTimeframe === item.value ? "selected" : ""}
                  key={item.value}
                  type="button"
                  aria-pressed={chartTimeframe === item.value}
                  onClick={() => setChartTimeframe(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button className="text-button" type="button" disabled={chartLoading} onClick={refreshCandles}>
              <RefreshCw size={15} />
              {selectedTimeframeLabel} 갱신
            </button>
          </div>
          <div className="chart-frame">
            <div className="chart-container" ref={chartContainerRef} />
            {chartLoading ? <div className="chart-state">캔들을 불러오는 중입니다.</div> : null}
            {!chartLoading && chartError ? <div className="chart-state error">{chartError}</div> : null}
            {!chartLoading && !chartError && candles.length === 0 ? (
              <div className="chart-state">표시할 캔들 데이터가 없습니다.</div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="grid">
        <article className="panel credentials">
          <div className="panel-title">
            <KeyRound size={18} />
            <h2>API 키</h2>
          </div>
          <label>
            Access Key
            <input
              value={keys.accessKey}
              onChange={(event) => setKeys((current) => ({ ...current, accessKey: event.currentTarget.value }))}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label>
            Secret Key
            <input
              value={keys.secretKey}
              onChange={(event) => setKeys((current) => ({ ...current, secretKey: event.currentTarget.value }))}
              type="password"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="switch">
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.currentTarget.checked)} />
            <span>주문 모의 실행</span>
          </label>
          <button className="secondary-button" type="button" disabled={busy || !isKeyReady} onClick={handleRefreshPrivateData}>
            <Wallet size={17} />
            잔고/주문 가능정보 조회
          </button>
          <button className="secondary-button" type="button" disabled={busy || !isKeyReady} onClick={handleOpenAssetWindow}>
            <Wallet size={17} />
            자산 창 열기
          </button>
          <p className="note">
            키는 화면 상태와 Rust 명령 호출에만 사용되며 파일로 저장하지 않습니다. 실거래 전 Upbit API Key 권한과 허용 IP를 확인하세요.
          </p>
        </article>

        <article className="panel strategy">
          <div className="panel-title">
            <Activity size={18} />
            <h2>자동 전략</h2>
          </div>
          <div className="form-grid">
            <label>
              감시 주기(초)
              <input
                value={strategy.intervalSec}
                inputMode="numeric"
                onChange={(event) => setStrategy((current) => ({ ...current, intervalSec: event.currentTarget.value }))}
              />
            </label>
            <label>
              쿨다운(초)
              <input
                value={strategy.cooldownSec}
                inputMode="numeric"
                onChange={(event) => setStrategy((current) => ({ ...current, cooldownSec: event.currentTarget.value }))}
              />
            </label>
            <label>
              이하 매수 기준가
              <input
                value={strategy.buyBelow}
                inputMode="decimal"
                placeholder="예: 90000000"
                onChange={(event) => setStrategy((current) => ({ ...current, buyBelow: event.currentTarget.value }))}
              />
            </label>
            <label>
              매수 금액(KRW)
              <input
                value={strategy.buyKrw}
                inputMode="decimal"
                onChange={(event) => setStrategy((current) => ({ ...current, buyKrw: event.currentTarget.value }))}
              />
            </label>
            <label>
              이상 매도 기준가
              <input
                value={strategy.sellAbove}
                inputMode="decimal"
                placeholder="예: 110000000"
                onChange={(event) => setStrategy((current) => ({ ...current, sellAbove: event.currentTarget.value }))}
              />
            </label>
            <label>
              매도 수량
              <input
                value={strategy.sellVolume}
                inputMode="decimal"
                placeholder="예: 0.001"
                onChange={(event) => setStrategy((current) => ({ ...current, sellVolume: event.currentTarget.value }))}
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className={running ? "danger-button" : "primary-button"}
              type="button"
              onClick={() => {
                setRunning((value) => !value);
                addLog(running ? "warn" : "info", running ? "자동 감시를 정지했습니다." : "자동 감시를 시작했습니다.");
              }}
            >
              {running ? <Square size={17} /> : <Play size={17} />}
              {running ? "정지" : "시작"}
            </button>
          </div>
          <p className="note">매수는 Upbit 시장가 매수 규칙에 따라 ord_type=price, 매도는 ord_type=market으로 전송합니다.</p>
        </article>

        <article className="panel manual">
          <div className="panel-title">
            <Send size={18} />
            <h2>수동 주문</h2>
          </div>
          <div className="form-grid">
            <label>
              side
              <select
                value={manualOrder.side}
                onChange={(event) =>
                  setManualOrder((current) => ({ ...current, side: event.currentTarget.value as OrderRequest["side"] }))
                }
              >
                <option value="bid">bid 매수</option>
                <option value="ask">ask 매도</option>
              </select>
            </label>
            <label>
              ord_type
              <select
                value={manualOrder.ord_type}
                onChange={(event) =>
                  setManualOrder((current) => ({
                    ...current,
                    ord_type: event.currentTarget.value as OrderRequest["ord_type"],
                  }))
                }
              >
                <option value="limit">limit 지정가</option>
                <option value="price">price 시장가 매수</option>
                <option value="market">market 시장가 매도</option>
                <option value="best">best 최유리</option>
              </select>
            </label>
            <label>
              가격/매수금액
              <input
                value={manualOrder.price ?? ""}
                inputMode="decimal"
                onChange={(event) => setManualOrder((current) => ({ ...current, price: event.currentTarget.value }))}
              />
            </label>
            <label>
              수량
              <input
                value={manualOrder.volume ?? ""}
                inputMode="decimal"
                onChange={(event) => setManualOrder((current) => ({ ...current, volume: event.currentTarget.value }))}
              />
            </label>
            <label>
              identifier
              <input
                value={manualOrder.identifier ?? ""}
                onChange={(event) => setManualOrder((current) => ({ ...current, identifier: event.currentTarget.value }))}
              />
            </label>
            <label>
              time_in_force
              <select
                value={manualOrder.time_in_force ?? ""}
                onChange={(event) =>
                  setManualOrder((current) => ({ ...current, time_in_force: event.currentTarget.value }))
                }
              >
                <option value="">없음</option>
                <option value="ioc">ioc</option>
                <option value="fok">fok</option>
                <option value="post_only">post_only</option>
              </select>
            </label>
          </div>
          <button className="primary-button" type="button" disabled={busy || (!dryRun && !isKeyReady)} onClick={handleManualOrder}>
            <Send size={17} />
            주문 전송
          </button>
        </article>

        <article className="panel risk">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>실거래 체크</h2>
          </div>
          <ul className="checklist">
            <li>기본값은 모의 실행이며, 실거래 전 체크박스를 해제해야 합니다.</li>
            <li>API Key는 필요한 권한만 부여하고 허용 IP를 등록하세요.</li>
            <li>전략은 단순 가격 조건입니다. 슬리피지, 수수료, 체결 지연은 별도 검증이 필요합니다.</li>
          </ul>
          <div className="warning-box">
            <AlertTriangle size={18} />
            <span>자동매매는 손실이 발생할 수 있습니다. 작은 금액과 모의 실행으로 먼저 검증하세요.</span>
          </div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel output-panel">
          <div className="panel-title">
            <BarChart3 size={18} />
            <h2>최근 응답</h2>
          </div>
          <div className="output-tabs">
            <pre>{compactJson({ ticker, accounts, chance, lastOrder })}</pre>
          </div>
        </article>

        <article className="panel log-panel">
          <div className="panel-title">
            <Activity size={18} />
            <h2>로그</h2>
          </div>
          <div className="logs">
            {logs.length === 0 ? (
              <span className="empty">아직 로그가 없습니다.</span>
            ) : (
              logs.map((log) => (
                <div className={`log-line ${log.level}`} key={log.id}>
                  <time>{log.at}</time>
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

export default App;
