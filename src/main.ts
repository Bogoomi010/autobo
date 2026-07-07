import Phaser from "phaser";
import { GAME_H, GAME_W } from "./game/config";
import { store } from "./game/state";
import { investment } from "./systems/InvestmentSystem";
import { BootScene } from "./scenes/BootScene";
import { OfficeScene } from "./scenes/OfficeScene";
import { initHud } from "./ui/hud";
import { initCoinModal } from "./ui/coinModal";
import { initKeyModal } from "./ui/keyModal";
import { sfx } from "./core/sfx";

// 브라우저 오디오 정책 — 최초 입력 시 오디오 컨텍스트 생성
window.addEventListener("pointerdown", () => sfx.init(), { once: true });
window.addEventListener("keydown", () => sfx.init(), { once: true });

async function boot(): Promise<void> {
  // UI를 먼저 붙여 연동 상태(CONNECT)·토스트·키 입력 모달이 처음부터 보이게 한다
  initHud();
  initCoinModal();
  initKeyModal();

  await store.init(); // 세이브 로드 + 실계좌 연동 (키 없으면 입력 모달 / 모의 모드면 가상 잔고)
  investment.start(); // 마켓 목록 로드 + 시세 폴링 + 자동 익절/손절

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: GAME_W,
    height: GAME_H,
    backgroundColor: "#1a1410",
    pixelArt: true, // 도트 감성 — 확대 시 네모 픽셀 유지 (텍스처 스무딩 끔)
    physics: { default: "arcade" },
    // DOM 오버레이(코인 모달 등) 위의 클릭이 Phaser까지 뚫고 들어가는 것을 차단
    input: { windowEvents: false },
    scene: [BootScene, OfficeScene],
  });

  // 창 크기에 맞춰 1280x720 전체(#wrap: 캔버스 + DOM UI)를 스케일
  function fitToWindow(): void {
    const wrap = document.getElementById("wrap")!;
    const s = Math.min(window.innerWidth / GAME_W, window.innerHeight / GAME_H);
    const tx = (window.innerWidth - GAME_W * s) / 2;
    const ty = (window.innerHeight - GAME_H * s) / 2;
    wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    // CSS transform 이후 포인터 좌표 보정을 위해 Phaser에 캔버스 경계 갱신을 알림
    game.scale.updateBounds();
  }

  fitToWindow();
  window.addEventListener("resize", fitToWindow);

  // 개발 콘솔 디버그용
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

void boot();
