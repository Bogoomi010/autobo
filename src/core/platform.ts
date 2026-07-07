/** Tauri 데스크톱 환경 여부 */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** 풀스크린 전환 — Tauri 창 API / 브라우저 Fullscreen API 자동 분기 */
export async function setFullscreen(on: boolean): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  if (on) {
    await document.documentElement.requestFullscreen();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
}
