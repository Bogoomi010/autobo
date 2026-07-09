/**
 * 매수봇 생성 창 — 봇마다 독립적인 예산(금액)/동작 시간대/익절·손절 퍼센트를 입력받는다.
 * EV.OPEN_BOT_CREATE_MODAL 수신 시 열리고, 확정하면 botEngine.addBot(settings)을 직접 호출한다.
 */
import { botEngine } from "../bots/botEngine";
import { BOT_TYPE_LABEL, DEFAULT_BOT_SETTINGS, type BotSettings, type BotType } from "../bots/types";
import { bus, EV } from "../game/events";
import { krw } from "../game/format";

const QUICK_BUDGETS = [5_000, 10_000, 50_000, 100_000];
const MIN_BUDGET_KRW = 5_000; // 업비트 최소 주문금액

const BOT_TYPE_OPTIONS: { type: BotType; text: string }[] = [
  { type: "scalp", text: `⚡ ${BOT_TYPE_LABEL.scalp} (최대 24시간 보유)` },
  { type: "longterm", text: `🌱 ${BOT_TYPE_LABEL.longterm} (최소 24시간 보유)` },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
  desc.textContent = "이 봇 전용 예산·동작 시간대·익절/손절 기준을 정해요.";

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

  // 동작 시간대
  const timeLabel = document.createElement("div");
  timeLabel.className = "bcm-section-label";
  timeLabel.textContent = "동작 시간대 (KST, 평일만)";

  const timeRow = document.createElement("div");
  timeRow.className = "bcm-time-row";
  const hourSelect = document.createElement("select");
  for (let h = 0; h < 24; h += 1) {
    const opt = document.createElement("option");
    opt.value = String(h);
    opt.textContent = pad2(h);
    hourSelect.append(opt);
  }
  const colon = document.createElement("span");
  colon.textContent = ":";
  const minuteSelect = document.createElement("select");
  for (let m = 0; m < 60; m += 10) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = pad2(m);
    minuteSelect.append(opt);
  }
  const durationInput = document.createElement("input");
  durationInput.type = "number";
  durationInput.min = "1";
  durationInput.max = "1440";
  durationInput.className = "bcm-duration";
  const durationSuffix = document.createElement("span");
  durationSuffix.textContent = "분간";
  timeRow.append(hourSelect, colon, minuteSelect, durationInput, durationSuffix);

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

  function setBudget(v: number): void {
    budget = Math.max(0, Math.floor(v));
    budgetInput.value = budget > 0 ? budget.toLocaleString("ko-KR") : "";
  }

  function setBotType(next: BotType): void {
    botType = next;
    for (const [t, btn] of typeButtons) btn.className = t === botType ? "pixel-btn" : "pixel-btn wood";
    timeHint.textContent =
      botType === "scalp"
        ? "이 시간이 끝나면 보유 중인 포지션도 강제로 매도돼요."
        : "매수 스캔에만 적용돼요. 매도는 최소 24시간 보유 후 익절/손절 기준을 따라요.";
  }

  function renderTimePreview(): void {
    const h = Number(hourSelect.value);
    const m = Number(minuteSelect.value);
    const dur = Math.max(1, Number(durationInput.value) || 0);
    const endTotal = h * 60 + m + dur;
    const endH = Math.floor(endTotal / 60) % 24;
    const endM = endTotal % 60;
    timePreview.textContent = `${pad2(h)}:${pad2(m)} ~ ${pad2(endH)}:${pad2(endM)} (평일)`;
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
    hourSelect.value = String(DEFAULT_BOT_SETTINGS.scanWindow.startHourKst);
    minuteSelect.value = String(DEFAULT_BOT_SETTINGS.scanWindow.startMinute);
    durationInput.value = String(DEFAULT_BOT_SETTINGS.scanWindow.durationMinutes);
    tpInput.value = String(DEFAULT_BOT_SETTINGS.takeProfitRate * 100);
    slInput.value = String(DEFAULT_BOT_SETTINGS.stopLossRate * 100);
    renderTimePreview();
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
    if (budget < MIN_BUDGET_KRW) {
      showError(`예산은 최소 ${krw(MIN_BUDGET_KRW)} 이상이어야 해요.`);
      return null;
    }
    const durationMinutes = Math.floor(Number(durationInput.value));
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      showError("동작 시간(분)은 1~1440 사이로 입력하세요.");
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
    return {
      botType,
      budgetKrw: budget,
      takeProfitRate: takeProfitPct / 100,
      stopLossRate: stopLossPct / 100,
      scanWindow: {
        startHourKst: Number(hourSelect.value),
        startMinute: Number(minuteSelect.value),
        durationMinutes,
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
  hourSelect.addEventListener("change", renderTimePreview);
  minuteSelect.addEventListener("change", renderTimePreview);
  durationInput.addEventListener("input", renderTimePreview);

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
