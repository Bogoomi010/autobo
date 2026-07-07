# 🏢 코인 오피스 (Autobo)

일본 도트 감성 타이쿤 게임으로 재탄생한 Autobo. 탑다운 사무실에서 캐릭터를 조작해
**실제 업비트 계좌로 코인을 매매**한다.

- **데스크톱 앱(Tauri) = ⚠ 실거래 모드** — 게임 조작이 곧 실제 시장가 매수/매도다.
- **브라우저(dev) = 🧪 모의 모드** — 가상 잔고 100만원 + 실시세. UI/게임 개발용.

기술 스택: TypeScript + Vite + Phaser 3 + Tauri 2 (Rust 업비트 클라이언트)

기획서: [docs/COIN_OFFICE_GDD.md](docs/COIN_OFFICE_GDD.md) ·
API 규칙: [docs/upbit-api-implementation-notes.md](docs/upbit-api-implementation-notes.md)

## 플레이 방법

1. **금고방**(좌측)에서 Space → 머리 위 셀렉터로 만원 단위 출금 (←→ ±1만 / ↑↓ ±10만)
2. 돈뭉치를 양손에 들고 **투자방**(우측) 코인 단말기에서 Space → 코인 시세판 모달
3. 코인 선택 → 확인 화면 → 들고 있는 금액 전액 **시장가 매수** (실거래 모드는 실제 주문!)
4. 평균 체결가 대비 **+3% 자동 익절 / -3% 자동 손절** (실제 시장가 매도) → 정산기가 체결액만큼 돈뭉치 배출
5. 배출된 돈을 주워(Space) 금고에 재입금

| 키 | 동작 |
| --- | --- |
| WASD / 방향키 | 이동 |
| Space | 상호작용 (금고·단말기·돈뭉치) |
| ESC | 셀렉터/모달 취소 (주문 전송 중엔 잠금) |

이 게임은 **게임에서 매수한 포지션만** 자동 매도한다. 계좌에 원래 있던 코인은 건드리지 않는다.

## 실행

```powershell
npm install
npm run tauri dev   # ⚠ 실거래 모드
```

실거래 모드는 실행 파일 옆 `upbitkey` 파일이 필요하다 (`tauri dev` 기준
`src-tauri/target/debug/upbitkey`). 형식:

```
access key
{액세스 키}
secret key
{시크릿 키}
```

브라우저 모의 모드 (실계좌 미사용):

```powershell
npm run dev   # http://localhost:1420
```

## 빌드 검증

```powershell
npm run tauri build
```

## 실거래 전 확인

- Upbit API Key에 필요한 권한(자산조회·주문조회·주문하기)만 부여했는지 확인한다.
- 허용 IP가 현재 실행 환경과 일치하는지 확인한다.
- 게임 상단의 "⚠ 실거래" 뱃지와 계좌 연동 상태를 확인한 뒤 플레이한다.
- 시장가 주문은 호가 상황에 따라 표시 가격과 체결가가 다를 수 있다 (슬리피지).
- 업비트 최소 주문 금액은 5,000원 — 게임 출금 단위(1만원)는 이를 충족한다.
