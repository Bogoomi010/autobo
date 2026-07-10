import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "./platform";

const BACKGROUND_TICK_EVENT = "bot-background-tick";
const FALLBACK_TICK_MS = 1_000;

type TickListener = (now: number) => void;

/**
 * 매수봇의 시간 기준을 화면/WebView 타이머와 분리한다.
 * Tauri에서는 Rust가 내보내는 1초 심박을 사용하고, 브라우저 개발 모드만 setInterval로 대체한다.
 */
class BackgroundTradingRuntime {
  private listeners = new Set<TickListener>();
  private active = false;
  private generation = 0;
  private unlisten: UnlistenFn | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.generation += 1;
    const generation = this.generation;

    if (!active) {
      this.stopLocalLoop();
      if (isTauri()) void invoke("set_background_trading_active", { active: false }).catch(() => {});
      return;
    }

    if (isTauri()) void this.startNativeLoop(generation);
    else this.startFallbackLoop();
  }

  private dispatch(now = Date.now()): void {
    if (!this.active) return;
    for (const listener of this.listeners) listener(now);
  }

  private async startNativeLoop(generation: number): Promise<void> {
    try {
      const unlisten = await listen<number>(BACKGROUND_TICK_EVENT, (event) => {
        this.dispatch(typeof event.payload === "number" ? event.payload : Date.now());
      });
      if (!this.active || generation !== this.generation) {
        unlisten();
        return;
      }
      this.unlisten = unlisten;
      await invoke("set_background_trading_active", { active: true });
      if (!this.active || generation !== this.generation) {
        await invoke("set_background_trading_active", { active: false }).catch(() => {});
        this.stopLocalLoop();
      }
    } catch {
      this.unlisten?.();
      this.unlisten = null;
      if (this.active && generation === this.generation) this.startFallbackLoop();
    }
  }

  private startFallbackLoop(): void {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => this.dispatch(), FALLBACK_TICK_MS);
  }

  private stopLocalLoop(): void {
    this.unlisten?.();
    this.unlisten = null;
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
  }
}

export const backgroundTrading = new BackgroundTradingRuntime();
