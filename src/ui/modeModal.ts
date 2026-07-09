/**
 * 시작 모드 선택 창 — 앱을 켜면 가장 먼저 뜬다.
 * 🧪 모의 / ⚠ 실거래 중 하나를 고르면 그 값으로 resolve 하고 창을 닫는다.
 * (선택 결과로 store.setMode → store.init 을 호출해야 HUD가 올바른 모드로 뜬다)
 */
import { isTauri } from "../core/platform";
import { sfx } from "../core/sfx";

export function chooseMode(): Promise<"sim" | "real"> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "modeModal";

    const panel = document.createElement("div");
    panel.className = "mode-panel pixel-panel";

    const title = document.createElement("div");
    title.className = "mode-title";
    title.textContent = "🏢 코인 오피스";

    const desc = document.createElement("div");
    desc.className = "mode-desc";
    desc.textContent = "어떤 방식으로 시작할까요?";

    const opts = document.createElement("div");
    opts.className = "mode-opts";

    // 모의 카드
    const simBtn = document.createElement("button");
    simBtn.className = "mode-card sim";
    simBtn.innerHTML =
      '<div class="mc-ic">🧪</div>' +
      '<div class="mc-name">모의 거래</div>' +
      '<div class="mc-sub">가상 자금 100만원으로<br>안전하게 연습해요</div>';

    // 실거래 카드
    const realBtn = document.createElement("button");
    realBtn.className = "mode-card real";
    realBtn.innerHTML =
      '<div class="mc-ic">⚠</div>' +
      '<div class="mc-name">실거래</div>' +
      '<div class="mc-sub">업비트 실계좌로 매매해요<br>API Key 입력이 필요해요</div>';

    opts.append(simBtn, realBtn);
    panel.append(title, desc, opts);

    // 브라우저(비 Tauri)에선 실거래 주문이 불가함을 안내 (선택은 허용 — 키 입력 흐름 확인용)
    if (!isTauri()) {
      const warn = document.createElement("div");
      warn.className = "mode-note";
      warn.textContent = "※ 실거래 주문은 데스크톱 앱에서만 체결됩니다 (브라우저는 시세만 실제).";
      panel.append(warn);
    }

    overlay.append(panel);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));

    function pick(mode: "sim" | "real"): void {
      overlay.classList.remove("open");
      // 페이드아웃 후 제거
      setTimeout(() => overlay.remove(), 200);
      resolve(mode);
    }

    simBtn.addEventListener("click", () => {
      sfx.card();
      pick("sim");
    });
    realBtn.addEventListener("click", () => {
      sfx.alarm();
      pick("real");
    });
  });
}
