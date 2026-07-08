# 로봇 매수봇 — 이식용 참고 문서

`main` 브랜치(커밋 `c21512e`, React 기반 구 아키텍처)에만 구현되어 있던 "로봇 매수봇" 기능의
핵심 로직을 게임(Phaser, `feature/coin-office`) 쪽으로 이식하기 전에 정리한 참고 자료다.
`main`을 게임 브랜치 내용으로 덮어쓰면서 원본 React 코드는 사라지므로, 알고리즘과 상태 머신을
여기 남겨둔다. 원본 커밋은 git 히스토리에 `c21512e`로 계속 남아있다(`git show c21512e:src/bots/...`).

## 요구사항 원문 (기획서 기준)

1. Access/Secret 키 입력 → 암호화되어 ROOT(실행 파일) 폴더에 저장. 재실행 시 저장된 키 발견하면
   연동 여부 질문 → 거절 시 키 입력창 표시. *(→ 게임 쪽엔 이미 동등한 기능이 `upbitkey.enc` +
   `keyModal.ts`로 존재한다. 이식 불필요.)*
2. 매수 봇 캐릭터를 제한 없이 추가 가능.
3. 한국시간 오전 9시에 급등 코인을 탐지 (API + 자체 알고리즘).
4. 탐지된 코인에 봇당 10,000원씩 즉시 시장가 매수.
5. +3% 수익 시 즉시 시장가 매도.
6. -2% 손실 시 즉시 시장가 매도.
7. 봇 캐릭터의 실제 움직임 애니메이션.
8. 봇은 로봇 모양(SVG).
9. 코인 목록은 실제 거래소 시세창처럼 항상 확인 가능. *(→ 게임 쪽엔 이미 트레이딩 보드로 존재.)*
10. 코인 클릭 시 실시간 차트(WS 체결 데이터로 마지막 캔들 실시간 갱신). *(→ 게임 쪽엔 이미
    `tradingBoard/chart.ts` + 틱 단위 웹소켓 갱신으로 존재, 더 발전된 버전.)*

**즉, 실제로 이식이 필요한 건 2~8번 — "봇 자체의 트레이딩 로직과 캐릭터"뿐이다.**
암호화 키 저장, 코인 목록, 실시간 차트는 게임 쪽에 이미 동등하거나 더 나은 버전이 있다.

## 설정값 (기본값)

| 항목 | 값 | 비고 |
| --- | --- | --- |
| `budgetKrw` | 10,000 | 봇 1회 매수 예산(원) — 업비트 최소 주문금액 5,000원 이상 |
| `takeProfitRate` | +0.03 (3%) | 익절 기준 수익률 |
| `stopLossRate` | 0.02 (2%, 즉 -2%) | 손절 기준 손실률 |
| `scanWindow` | KST 09:00 ~ 09:30 | 평일만(주말 제외), 매일 자동 재개 |
| `minLiquidityKrw24h` | 1,000,000,000 (10억원) | 유동성 필터 — 24h 누적 거래대금 하한 |
| `feeRate` | 0.0005 (0.05%) | 수수료율, 손익 계산에 매수/매도 양쪽 반영 |

## 봇 상태 머신

```
idle → scanning(스캔 창 진입) → targeting(후보 배정) → buying → holding
  → selling → sold_profit | sold_loss → (쿨다운 10초) → idle
  (오류 시 어느 상태에서든) → error → (30초 후) → idle
```

- `scanning`: 스캔 창(09:00~09:30 KST, 또는 수동 스캔 5분) 동안 대기하며 배정을 기다리는 상태.
- `targeting`: 급등 후보가 배정되어 매수 주문을 막 시작한 상태(찰나, buying으로 즉시 전이).
- `holding`: 매수 체결 완료, 매 틱(1초)마다 현재가로 손익률 재계산.
- `sold_profit`/`sold_loss`: 매도 체결 완료 직후 결과 표시 상태, 10초 후 자동으로 idle 복귀.
- `error`: 매수/매도 실패(체결 수량 확인 실패, API 오류 등), 30초 후 idle로 자동 복구.
- 봇 명단(id·name)만 `localStorage`에 영속화. 런타임 포지션(보유 코인 등)은 영속화하지 않음 —
  새로고침/재시작 시 보유 포지션은 idle로 리셋되고 경고 로그만 남긴다(주의: 실제 계좌엔 코인이
  남아있을 수 있으므로 게임 쪽 이식 시 `store.positions`와의 정합성/보정 로직을 고려할 것).

## 메인 루프 (1초 tick)

매초 다음을 순서대로 수행:

1. 현재 스캔 창 활성 여부 판정 (`isWithinDailyScanWindow` — KST 평일 09:00~09:30, 또는 수동 스캔
   활성 중이면 5분간 강제 활성).
2. 봇별 동기 상태 전이 처리 (idle↔scanning, holding 손익률 갱신, sold_*/error 쿨다운 복귀).
3. `holding` 상태 봇마다 현재가 조회 → 손익률이 +3% 이상이면 익절 매도, -2% 이하면 손절 매도
   트리거 (봇당 in-flight 플래그로 중복 매도 방지).
4. 스캔 창 활성 && 마지막 급등 스캔으로부터 3초 이상 경과 시: 전체 KRW 마켓에 대해 급등 점수화 →
   점수 내림차순 정렬 → `scanning`/`idle` 상태이고 아직 타겟이 없는 봇들에게 점수 25점 이상인
   후보부터 순서대로 배정(이미 다른 봇에 배정된 마켓은 제외) → 즉시 매수 실행.

체결 데이터용 롤링 이력은 최근 60초 윈도만 유지(오래된 항목은 매 틱마다 제거).

## 급등 탐지 점수화 알고리즘

```
종합 점수(0~100) = 100 × (
    0.35 × normalize(시가대비상승률, 0~10%)
  + 0.25 × normalize(체결대금가속도, 1~5배)
  + 0.20 × normalize(매수체결비중, 50%~100%만 가점)
  + 0.20 × normalize(시장대비 z-score, 1.5~3.5)
)
```

편입 조건(둘 다 충족해야 후보가 됨):
- 유동성 필터: 24h 누적 거래대금 ≥ `minLiquidityKrw24h`(10억원)
- z-score 필터: 전체 KRW 마켓의 `signed_change_rate` 분포에서 z ≥ 1.5 (급등 이상치)

성분별 계산:
- **시가 대비 상승률**: `(현재가 - 09:00시가) / 09:00시가`. 09:00 시가를 직접 못 구하면
  최근 1분 캔들 중 가장 오래된 캔들의 시가로 대체, 그것도 없으면 전일 대비 등락률로 대체.
- **체결대금 가속도**: `최근 30초 누적체결대금 / 직전 30초 누적체결대금`, [0, 5] 클램프.
  누적값 스냅샷 이력에서 시각 기준으로 30초/60초 전 값을 찾아 차분.
- **매수 체결 비중**: 윈도 내 `매수 주도 체결대금 증가분 / 전체 체결대금 증가분`, [0, 1] 클램프.
- **z-score**: `(해당 마켓 signed_change_rate - 전체 평균) / 전체 표준편차`.

배정 시 최소 점수 임계값 25점(0~100 스케일) 미만이면 배정하지 않는다(정렬되어 있으므로 그 이하
후보도 스킵).

## 매수/매도 실행

- 매수: `ord_type=price`, `price=budgetKrw`(10,000원) 시장가 매수 주문 (게임 쪽 `placeOrder`/
  `store.invest`와 동일한 Upbit 주문 형태).
  - dry-run(모의): 매수 시점 현재가로 즉시 체결 시뮬레이션 (`volume = budget×(1-fee) / price`).
  - 실거래: 주문 후 최대 5회(1초 간격) 계좌 잔고를 재조회해 해당 코인 잔고가 잡히면 체결로 간주,
    평균매수가/수량을 계좌 응답에서 읽음. 5회 내 확인 안 되면 `error` 상태로 전이.
- 매도: `ord_type=market`, `volume=보유수량` 시장가 매도. 체결 후 현재가 기준으로 실현손익
  계산(`proceeds = price×volume×(1-fee)`, `cost = entry×volume×(1+fee)`).
- 매수/매도 모두 봇 단위 in-flight 플래그로 중복 주문 방지.

## 게임(Phaser) 쪽 이식 시 참고할 기존 자산

이미 존재하므로 그대로 재사용 가능:
- `src/api/upbit.ts` — `placeOrder`, `fetchAllKrwTickers`, `fetchCandles`, `fetchRecentTrades` 등.
- `src/systems/InvestmentSystem.ts` — 시세 폴링(3초), `getMarkets()`/`getTicker()` 캐시. 봇 엔진의
  틱 루프는 이 캐시를 그대로 활용할 수 있다.
- `src/game/state.ts`(`store`) — `mode`("sim"|"real"), `invest()`/`closePosition()` 패턴 참고.
  단, 봇은 플레이어의 "들고 있는 돈"(carried) 메커니즘과 무관하게 독립적으로 주문해야 하므로
  `store.positions`와는 별도의 포지션 목록을 봇 엔진 자체가 들고 있어야 한다(원본 React 버전과
  동일한 설계 — `TradeBot[]`을 봇 엔진이 직접 관리).
- `src/game/events.ts`(`bus`) — 신규 이벤트(`BOT_*`) 추가해 UI(도크)와 통신.

새로 필요한 것:
- 봇 엔진 모듈 (`useBotEngine.ts`의 setInterval 기반 로직을 프레임워크 독립적인 클래스/함수로 이식,
  React state 대신 `bus` 이벤트로 UI에 통지).
- 급등 스코어러 (`surge.ts`는 순수 함수라 거의 그대로 포팅 가능, 타입만 게임 쪽 `Ticker`/`Candle`에
  맞게 조정).
- 봇 UI: 원본은 SVG 로봇이 도크를 돌아다니는 애니메이션(`BotDock.tsx`/`bots.css`, 상태별 배회·돌진·
  말풍선 연출). 게임 쪽엔 Phaser 월드에 실제로 걸어다니는 로봇 스프라이트를 넣거나, 기존 모달/패널
  패턴처럼 DOM 도크로 단순화하는 두 가지 선택지가 있음 — 스코프에 맞춰 결정.

## 원본 소스 위치 (git 히스토리)

```
git show c21512e:src/bots/types.ts
git show c21512e:src/bots/surge.ts
git show c21512e:src/bots/useBotEngine.ts
git show c21512e:src/bots/BotDock.tsx
git show c21512e:src/bots/bots.css
git show c21512e:docs/robot-buyer-bots-plan.md
git show c21512e:docs/robot-buyer-bots-integration.md
git show c21512e:docs/robot-buyer-bots-result.md
```
