/**
 * 매수봇 생성 창 — 봇마다 독립적인 예산(금액)/투자 시간/익절·손절 퍼센트를 입력받는다.
 * EV.OPEN_BOT_CREATE_MODAL 수신 시 열리고, 확정하면 botEngine.addBot(settings)을 직접 호출한다.
 */
import noUiSlider from "nouislider";
import "nouislider/dist/nouislider.css";
import { botEngine } from "../bots/botEngine";
import {
  BOT_MAX_BUDGET_KRW,
  BOT_MAX_LONGTERM_DURATION_MINUTES,
  BOT_MIN_BUDGET_KRW,
  BOT_MIN_LONGTERM_DURATION_MINUTES,
  BOT_TYPE_LABEL,
  DEFAULT_BOT_SETTINGS,
  type BotSettings,
  type BotType,
} from "../bots/types";
import { bus, EV } from "../game/events";
import { krw } from "../game/format";

const QUICK_BUDGETS = [BOT_MIN_BUDGET_KRW, 10_000, 20_000, 50_000];

const BOT_TYPE_OPTIONS: { type: BotType; text: string }[] = [
  { type: "scalp", text: `⚡ ${BOT_TYPE_LABEL.scalp} (최대 24시간 보유)` },
  { type: "longterm", text: `🌱 ${BOT_TYPE_LABEL.longterm} (1~30일 · 손절 즉시)` },
];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MIN = 1440;
const DURATION_STEP_MINUTES = 30;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 지속시간 슬라이더 값 → 단타는 시간/분, 장투는 일/시간으로 표시 */
function fmtDuration(raw: number | string): string {
  const t = Math.round(Number(raw) / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
  if (t >= DAY_MIN) {
    const days = Math.floor(t / DAY_MIN);
    const hours = Math.floor((t % DAY_MIN) / 60);
    return hours === 0 ? `${days}일` : `${days}일 ${hours}시간`;
  }
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function kstTimeParts(at: number): { hour: number; minute: number } {
  const d = new Date(at + KST_OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

function fmtKstDateTime(at: number): string {
  const d = new Date(at + KST_OFFSET_MS);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${month}/${day} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function initBotCreateModal(): void {
  const ui = document.getElementById("ui")!;

  const overlay = document.createElement("div");
  overlay.id = "botCreateModal";

  const panel = document.createElement("div");
  panel.className = "bcm-panel pixel-panel";

  const title = document.createElement("div");
  title.className = "bcm-title";
  title.textContent = "🤖 매수봇 생성";

  const desc = document.createElement("div");
  desc.className = "bcm-desc";
  desc.textContent = "이 봇 전용 예산·투자 시간·익절/손절 기준을 정해요.";

  // 봇 종류
  const typeLabel = document.createElement("div");
  typeLabel.className = "bcm-section-label";
  typeLabel.textContent = "봇 종류";

  const typeRow = document.createElement("div");
  typeRow.className = "bcm-quick";
  const typeButtons = new Map<BotType, HTMLButtonElement>();
  for (const opt of BOT_TYPE_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = opt.text;
    b.addEventListener("click", () => setBotType(opt.type));
    typeButtons.set(opt.type, b);
    typeRow.append(b);
  }

  // 금액
  const budgetLabel = document.createElement("label");
  budgetLabel.textContent = "매수 예산 (1회, KRW)";
  const budgetInput = document.createElement("input");
  budgetInput.type = "text";
  budgetInput.inputMode = "numeric";
  budgetInput.autocomplete = "off";
  budgetLabel.append(budgetInput);

  const budgetQuick = document.createElement("div");
  budgetQuick.className = "bcm-quick";
  for (const amt of QUICK_BUDGETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pixel-btn tiny wood";
    b.textContent = krw(amt);
    b.addEventListener("click", () => setBudget(amt));
    budgetQuick.append(b);
  }

  // 투자 시간
  const timeLabel = document.createElement("div");
  timeLabel.className = "bcm-section-label";
  timeLabel.textContent = "투자 시간";

  const timeRow = document.createElement("div");
  timeRow.className = "bcm-time-row";

  const durationBlock = document.createElement("div");
  durationBlock.className = "bcm-slider-block";
  const durationBlockLabel = document.createElement("div");
  durationBlockLabel.className = "bcm-slider-label";
  durationBlockLabel.textContent = "지금부터";
  const durationSliderEl = document.createElement("div");
  durationSliderEl.className = "bcm-time-slider";
  durationBlock.append(durationBlockLabel, durationSliderEl);

  timeRow.append(durationBlock);

  const numFormat = { to: (v: number) => String(Math.round(v)), from: (v: string) => Number(v) };
  const durationSlider = noUiSlider.create(durationSliderEl, {
    start: [DEFAULT_BOT_SETTINGS.scanWindow.durationMinutes],
    behaviour: "drag",
    range: { min: DURATION_STEP_MINUTES, max: DAY_MIN },
    step: DURATION_STEP_MINUTES,
    tooltips: [{ to: fmtDuration, from: Number }],
    format: numFormat,
  });

  const timePreview = document.createElement("div");
  timePreview.className = "bcm-time-preview";

  const timeHint = document.createElement("div");
  timeHint.className = "bcm-desc";

  // 익절/손절 퍼센트
  const pctRow = document.createElement("div");
  pctRow.className = "bcm-pct-row";
  const tpLabel = document.createElement("label");
  tpLabel.textContent = "익절 %";
  const tpInput = document.createElement("input");
  tpInput.type = "number";
  tpInput.step = "0.1";
  tpInput.min = "0.1";
  tpLabel.append(tpInput);
  const slLabel = document.createElement("label");
  slLabel.textContent = "손절 %";
  const slInput = document.createElement("input");
  slInput.type = "number";
  slInput.step = "0.1";
  slInput.min = "0.1";
  slLabel.append(slInput);
  pctRow.append(tpLabel, slLabel);

  const error = document.createElement("div");
  error.className = "bcm-error";

  const actions = document.createElement("div");
  actions.className = "bcm-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "pixel-btn wood";
  cancelBtn.textContent = "취소";
  const createBtn = document.createElement("button");
  createBtn.className = "pixel-btn";
  createBtn.textContent = "🤖 생성";
  actions.append(cancelBtn, createBtn);

  panel.append(
    title,
    desc,
    typeLabel,
    typeRow,
    budgetLabel,
    budgetQuick,
    timeLabel,
    timeRow,
    timePreview,
    timeHint,
    pctRow,
    error,
    actions
  );
  overlay.append(panel);
  ui.append(overlay);

  // ── 상태 ───────────────────────────────────────────────────
  let isOpen = false;
  let budget = DEFAULT_BOT_SETTINGS.budgetKrw;
  let botType: BotType = DEFAULT_BOT_SETTINGS.botType;
  let scanDurationMinutes = DEFAULT_BOT_SETTINGS.scanWindow.durationMinutes;

  // 슬라이더 값 변경 → 상태로 반영 — 프로그램적 set()에도 동일하게 호출된다
  durationSlider.on("update", (values) => {
    scanDurationMinutes = Number(values[0]);
    renderTimePreview();
  });

  function setBudget(v: number): void {
    budget = Math.max(0, Math.min(BOT_MAX_BUDGET_KRW, Math.floor(v)));
    budgetInput.value = budget > 0 ? budget.toLocaleString("ko-KR") : "";
  }

  function setBotType(next: BotType): void {
    botType = next;
    for (const [t, btn] of typeButtons) btn.className = t === botType ? "pixel-btn" : "pixel-btn wood";
    if (botType === "scalp") {
      durationBlockLabel.textContent = "지금부터";
      durationSlider.updateOptions({ range: { min: DURATION_STEP_MINUTES, max: DAY_MIN }, step: DURATION_STEP_MINUTES }, false);
      durationSlider.set(Math.min(scanDurationMinutes, DAY_MIN));
      timeHint.textContent = "선택한 시간이 끝나면 보유 중인 포지션도 강제로 매도돼요.";
    } else {
      durationBlockLabel.textContent = "최대 보유기간";
      durationSlider.updateOptions(
        { range: { min: BOT_MIN_LONGTERM_DURATION_MINUTES, max: BOT_MAX_LONGTERM_DURATION_MINUTES }, step: DAY_MIN },
        false
      );
      durationSlider.set(Math.max(BOT_MIN_LONGTERM_DURATION_MINUTES, scanDurationMinutes));
      timeHint.textContent = "손절·익절률은 즉시 적용하고, 붕괴 신호는 24시간 후부터 판단해요. 매도 수익은 다음 투자 원금에 합산해요.";
    }
  }

  function renderTimePreview(): void {
    const startAt = Date.now();
    const endAt = startAt + scanDurationMinutes * 60_000;
    timePreview.textContent =
      botType === "longterm"
        ? `최대 ${fmtDuration(scanDurationMinutes)} 보유 · 신규 스캔 ${fmtKstDateTime(startAt)} ~ ${fmtKstDateTime(endAt)} KST`
        : `지금부터 ${fmtDuration(scanDurationMinutes)} · ${fmtKstDateTime(startAt)} ~ ${fmtKstDateTime(endAt)} KST`;
  }

  function showError(msg: string): void {
    error.textContent = msg;
    error.classList.add("on");
  }

  function clearError(): void {
    error.textContent = "";
    error.classList.remove("on");
  }

  function resetForm(): void {
    setBotType(DEFAULT_BOT_SETTINGS.botType);
    setBudget(DEFAULT_BOT_SETTINGS.budgetKrw);
    // "update" 리스너가 상태/프리뷰까지 같이 갱신
    durationSlider.set(DEFAULT_BOT_SETTINGS.scanWindow.durationMinutes);
    tpInput.value = String(DEFAULT_BOT_SETTINGS.takeProfitRate * 100);
    slInput.value = String(DEFAULT_BOT_SETTINGS.stopLossRate * 100);
  }

  // ── 열기/닫기 ──────────────────────────────────────────────
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    clearError();
    resetForm();
    overlay.classList.add("open");
    setTimeout(() => budgetInput.focus(), 0);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove("open");
  }

  function readSettings(): BotSettings | null {
    if (budget < BOT_MIN_BUDGET_KRW) {
      showError(`안전 운용을 위해 예산은 ${krw(BOT_MIN_BUDGET_KRW)} 이상이어야 해요.`);
      return null;
    }
    if (
      botType === "longterm" &&
      (scanDurationMinutes < BOT_MIN_LONGTERM_DURATION_MINUTES || scanDurationMinutes > BOT_MAX_LONGTERM_DURATION_MINUTES)
    ) {
      showError("장투봇 보유기간은 1일에서 30일 사이여야 해요.");
      return null;
    }
    const takeProfitPct = Number(tpInput.value);
    if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) {
      showError("익절 %는 0보다 커야 해요.");
      return null;
    }
    const stopLossPct = Number(slInput.value);
    if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) {
      showError("손절 %는 0보다 커야 해요.");
      return null;
    }
    const startAt = Date.now();
    const endAt = startAt + scanDurationMinutes * 60_000;
    const { hour, minute } = kstTimeParts(startAt);
    return {
      botType,
      budgetKrw: budget,
      takeProfitRate: takeProfitPct / 100,
      stopLossRate: stopLossPct / 100,
      scanWindow: {
        startHourKst: hour,
        startMinute: minute,
        durationMinutes: scanDurationMinutes,
        startAt,
        endAt,
      },
    };
  }

  function submit(): void {
    clearError();
    const settings = readSettings();
    if (!settings) return;
    botEngine.addBot(settings);
    bus.emit(EV.TOAST, "🤖 새 매수봇을 생성했어요", "good");
    close();
  }

  // ── 입력 ───────────────────────────────────────────────────
  budgetInput.addEventListener("input", () => {
    clearError();
    const digits = budgetInput.value.replace(/[^0-9]/g, "");
    setBudget(digits ? Number(digits) : 0);
  });
  createBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") close();
    e.stopPropagation(); // 게임 캔버스로 키 입력 전파 차단
  });

  bus.on(EV.OPEN_BOT_CREATE_MODAL, open);
}
