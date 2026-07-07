import Phaser from "phaser";
import { generateTextures } from "../gfx/textures";

/**
 * [에이전트 B]
 * 절차적 텍스처 생성 + 캐릭터 걷기 애니메이션 등록 → OfficeScene 시작.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    generateTextures(this);

    // 4방향 걷기 애니메이션 (프레임마다 개별 텍스처 키 사용)
    const walk = (key: string, base: string): void => {
      this.anims.create({
        key,
        frames: [`${base}_0`, `${base}_1`, `${base}_0`, `${base}_2`].map((k) => ({ key: k })),
        frameRate: 8,
        repeat: -1,
      });
    };
    walk("walk-down", "char_down");
    walk("walk-up", "char_up");
    walk("walk-side", "char_side"); // 좌향은 씬에서 flipX

    this.scene.start("Office");
  }
}
