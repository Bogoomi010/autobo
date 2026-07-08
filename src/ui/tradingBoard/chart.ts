import {
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import type { Candle } from "../../game/types";

/** 왼쪽 끝에서 이만큼(봉 개수) 이내로 스크롤/줌하면 과거 데이터를 더 요청한다 */
const LOAD_MORE_THRESHOLD_BARS = 30;

/** 캔들+거래량 차트 인스턴스 — board.ts가 마켓/타임프레임 전환 시 setData, 실시간 틱마다 updateLast를 호출한다 */
export interface PriceChart {
  setData(candles: Candle[]): void;
  /** 과거 캔들을 앞쪽에 이어붙인다(older는 오름차순, 기존 데이터보다 전부 이전 시간이어야 함) — 화면 위치는 그대로 유지된다 */
  prependData(older: Candle[]): void;
  updateLast(candle: Candle): void;
  resize(): void;
  destroy(): void;
}

// 게임 팔레트(index.html --up/--down)와 통일 — 한국 거래소 관례(상승=빨강/하락=파랑)
const UP_COLOR = "#e5484d";
const DOWN_COLOR = "#3b82f6";
const INK = "#3d2a1a";
const CREAM = "#f7ecd4";
const GRID = "rgba(61, 42, 26, 0.08)";
const FONT = "Galmuri11, 'Malgun Gothic', sans-serif";

/** 캔들 하나를 lightweight-charts 캔들스틱 데이터 포맷으로 변환 */
function toCandlestickPoint(candle: Candle) {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

/** 캔들 하나를 lightweight-charts 거래량 히스토그램 데이터 포맷으로 변환 (상승=빨강/하락=파랑) */
function toVolumePoint(candle: Candle) {
  return {
    time: candle.time as UTCTimestamp,
    value: candle.volume,
    color: candle.close >= candle.open ? UP_COLOR : DOWN_COLOR,
  };
}

/**
 * container 안에 게임 테마(크림/도트폰트) 캔들스틱+거래량 차트를 생성한다.
 * @param onNeedMoreHistory 왼쪽 끝 근처로 스크롤하거나 축소(zoom-out)해 과거 데이터가 더 필요할 때 호출된다.
 *   board.ts가 이 콜백에서 과거 캔들을 추가로 fetch해 prependData로 이어붙인다.
 */
export function createPriceChart(container: HTMLElement, onNeedMoreHistory: () => void): PriceChart {
  const chart: IChartApi = createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: ColorType.Solid, color: CREAM },
      textColor: INK,
      fontFamily: FONT,
    },
    grid: {
      vertLines: { color: GRID },
      horzLines: { color: GRID },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: INK,
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: true,
      borderColor: INK,
      // 최신 캔들이 항상 오른쪽 끝에 붙어 있도록 고정 — 그 너머(미래 방향)로는 스크롤/줌 불가.
      // 새 캔들이 추가될 때(updateLast)도 오른쪽 끝이 보이고 있었다면 자동으로 따라가며 갱신된다.
      rightOffset: 2,
      fixRightEdge: true,
      // 로드된 가장 오래된 캔들(최종적으로는 상장일 최초 캔들) 너머로는 스크롤/줌 불가.
      // onNeedMoreHistory가 이 경계에 닿기 전에 미리 과거 데이터를 이어붙이므로 평소엔 끊김이 느껴지지 않고,
      // 더 이상 불러올 과거 데이터가 없을 때만(noMoreHistory) 실제 최대 이동 한계로 작동한다.
      fixLeftEdge: true,
      shiftVisibleRangeOnNewBar: true,
    },
  });

  const candleSeries: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    borderUpColor: UP_COLOR,
    borderDownColor: DOWN_COLOR,
    wickUpColor: UP_COLOR,
    wickDownColor: DOWN_COLOR,
  });
  // 캔들은 위쪽 60%만 사용 — 아래 거래량 패널과 높이가 겹치지 않게 자기 스케일에도 여백을 둔다
  candleSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.08, bottom: 0.32 },
  });

  const volumeSeries: ISeriesApi<"Histogram"> = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "coin-office-volume",
  });
  // 거래량 패널은 차트 하단 20%(78%~98%)에만 표시 — 캔들 영역과 사이에 빈 여백을 둬 시각적으로 분리한다
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.78, bottom: 0.02 },
  });

  // 현재 로드된 전체 캔들(오름차순) — prependData 시 병합 기준, updateLast 시에도 함께 갱신해 정합성을 유지한다
  let allCandles: Candle[] = [];

  const handleVisibleRangeChange = (range: LogicalRange | null): void => {
    if (!range) return;
    if (range.from < LOAD_MORE_THRESHOLD_BARS) onNeedMoreHistory();
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

  const resizeObserver = new ResizeObserver(() => {
    resize();
  });
  resizeObserver.observe(container);

  function resize(): void {
    chart.resize(container.clientWidth, container.clientHeight);
  }

  function setData(candles: Candle[]): void {
    allCandles = candles;
    candleSeries.setData(candles.map(toCandlestickPoint));
    volumeSeries.setData(candles.map(toVolumePoint));
    chart.timeScale().fitContent();
  }

  function prependData(older: Candle[]): void {
    if (older.length === 0) return;
    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    allCandles = [...older, ...allCandles];
    candleSeries.setData(allCandles.map(toCandlestickPoint));
    volumeSeries.setData(allCandles.map(toVolumePoint));
    // setData는 뷰를 초기화하지 않지만 논리 인덱스가 older.length만큼 밀리므로 보이던 위치를 그대로 보정해준다
    if (visibleRange) {
      chart.timeScale().setVisibleLogicalRange({
        from: visibleRange.from + older.length,
        to: visibleRange.to + older.length,
      });
    }
  }

  function updateLast(candle: Candle): void {
    const last = allCandles[allCandles.length - 1];
    if (last && last.time === candle.time) {
      allCandles = [...allCandles.slice(0, -1), candle];
    } else {
      allCandles = [...allCandles, candle];
    }
    candleSeries.update(toCandlestickPoint(candle));
    volumeSeries.update(toVolumePoint(candle));
  }

  function destroy(): void {
    chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    resizeObserver.disconnect();
    chart.remove();
  }

  return { setData, prependData, updateLast, resize, destroy };
}
