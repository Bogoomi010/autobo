# 로봇 매수봇(단타봇/장투봇) 알고리즘 문서

이 문서는 `src/bots/botEngine.ts`, `src/bots/surge.ts`, `src/bots/types.ts`에 구현된 자동매매
알고리즘을 코드 기준으로 정리한 레퍼런스다. 코드가 바뀌면 이 문서도 같이 갱신한다.

관련 문서: `docs/BTC_BOT_AGENT_CONTEXT.md`(설계 원칙), `docs/robot-buyer-bot-reference.md`(원본 React 설계).

---

## 1. 개요

로봇 매수봇은 Upbit KRW 마켓에서 실시간으로 급등하는 코인을 탐지해 시장가로 매수하고,
익절/손절 또는 추세 반전 신호가 오면 매도하는 자동매매 엔진이다. `BotEngine` 싱글턴이
1초 tick 루프(`runTick`)로 동작하며, 각 로봇 봇은 아래 상태 머신을 따른다.

```
idle → scanning → targeting → buying → holding → selling → sold_profit/sold_loss → idle
                                  ↑                                        ↓
                                error ←────────────────────────────────────┘
```

- `idle`/`scanning`: 스캔 창(동작 시간대) 활성 여부에 따라 전환. 매수 대상 없음.
- `targeting`: 급등 스캔에서 마켓이 배정된 직후(매수 시도 전 잠깐).
- `buying`: 매수 주문 전송~체결 확인 중.
- `holding`: 매수 완료, 포지션 보유 중. 매 tick마다 손익/최고가를 갱신하고 시장 스냅샷을 기록.
- `selling`: 매도 주문 전송~체결 확인 중.
- `sold_profit`/`sold_loss`: 매도 완료, 10초(`SOLD_COOLDOWN_MS`) 쿨다운 후 `idle`로 복귀.
- `error`: 매수/매도 실패, 30초(`ERROR_RECOVER_MS`) 후 `idle`로 복귀.

포지션(진입가/수량 등 "지금 이 순간의 보유 상태")은 앱 재시작 시 초기화된다 — 재시작 시점의
실제 시세와 괴리될 위험이 있어 의도적으로 복원하지 않는다. 반면 "쌓이는 데이터"인 누적
실현손익(`realizedPnlKrw`)·거래 횟수(`tradesDone`)·활동 로그(`logs`)·개별 운용 여부(`enabled`)는 명단(`id`/`name`/`settings`)과
함께 매 변경마다 그대로 저장돼(`localStorage` 키 `coin_office_bots_roster`) 앱을 언제 종료해도
잃지 않는다. 재시작 후에는 봇이 `idle`로 돌아가 있지만 누적 지표와 로그는 이어진다.

`TradeBot.logs`(`BotLogEntry[]`)는 조준/매수/매도/오류 등 주요 상태 전환 시각에 한 줄씩 쌓는
활동 로그다(`BotEngine.appendLogFor`, 최근 `BOT_LOG_MAX`=30건만 유지). §6의 CSV와는 별도로,
왼쪽 방 매수봇 로봇을 클릭했을 때 뜨는 상세 패널(`botDetailModal.ts`)에서 "어떻게 투자했는지"를
바로 훑어보는 용도다.

### 1.1 원금 범위와 수익 처리

1회 매수 예산(`BotSettings.budgetKrw`)은 업비트 KRW 마켓 최소 주문금액 5,000원에
손실·수수료 완충을 더한 `BOT_MIN_BUDGET_KRW`(6,000원)부터 앱 안전 상한
`BOT_MAX_BUDGET_KRW`(100,000원)까지 설정한다.
생성 창(`botCreateModal.ts`), 명단 로드(`clampSettings`), 실제 주문 직전(`executeBuy`)에 같은 범위를
적용한다. 기존 저장 봇의 예산이 6,000원 미만이면 6,000원으로 마이그레이션하되, 주문액이 사용자
확인 없이 증가한 채 실행되지 않도록 해당 봇을 `enabled=false`로 불러온다.

원금은 매 라운드 그대로 재사용하고(=봇 실적에 따라 커지지 않음), 수익은 매도 성공 즉시
플레이어의 금고로 들어간다:
- **모의 모드**: `realized > 0`이면 `store.creditVaultFromBot(realized)`로 정산기 돈뭉치
  연출 없이 곧바로 `simBalance`에 합산하고, `EV.BOT_PROFIT_CREDITED`를 emit해 `botFloor.ts`가
  그 봇 책상 위에 "+₩N" 획득 텍스트를 띄운다. 손실(`realized <= 0`)은 금고에서 따로 차감하지
  않는다 — 봇은 매수 시점에 금고에서 실제로 돈을 꺼내가지 않으므로 잃을 금고 돈이 없다.
- **실거래 모드**: 매도 주문 자체가 실계좌에서 체결되므로 돈은 이미 계좌에 들어가 있다.
  `executeBuy`/`executeSell` 양쪽에서 `store.refreshAccounts()`를 호출해 금고 표시(계좌 조회값)만
  바로 갱신한다.

### 1.2 개별 시작/중지와 월드 표시

각 로봇을 클릭하면 상세 패널에서 해당 봇만 시작하거나 중지할 수 있다(`setBotEnabled`). 개별 중지는
**신규 매수만 차단**한다. 이미 `buying`/`holding`/`selling` 상태인 포지션은 방치하지 않고 기존
익절·손절·기간 만료 규칙으로 계속 감시하고 청산한다. 전체 on/off는 별도의 엔진 킬스위치로 유지한다.

`holding` 또는 `selling` 상태이면서 `currentPnlRate`가 있으면 로봇 머리 위에 현재 수익률을 표시한다.
양수는 `수익 +N.NN%`(빨강), 음수는 `손실 -N.NN%`(파랑)로 나타낸다.

---

## 2. 봇 종류 — 단타봇 / 장투봇

두 종류는 **매도 알고리즘 자체는 완전히 동일**하고, "매도 판정을 언제부터 허용하는가"만 다르다.

| | 단타봇(`scalp`) | 장투봇(`longterm`) |
|---|---|---|
| 매도 판정 시작 조건 | 세션(스캔 창) 안에서만 | 매수 후 최소 24시간(`BOT_HOLD_LIMIT_MS`) 경과 후 |
| 세션/기간이 끝나면 | 보유 중이어도 강제 매도(`reason: "timeout"`) | 설정한 최대 보유기간(1~30일)에 강제 매도(`reason: "timeout"`) |
| 24시간 전 신호(TP/SL/붕괴 스코어) | 세션 중이면 그대로 반영 | 전부 무시하고 보유 |

세션(스캔 창)은 `BotSettings.scanWindow`로 지정한다. 새로 생성하는 단타봇은 생성 시점부터 사용자가
고른 지속시간까지의 **1회성 창**으로 저장된다(`startAt`/`endAt`, 30분 단위, 최대 24시간).
구버전 저장 봇처럼 `startAt`/`endAt`이 없는 설정은 기존 KST 시작시각 + 지속시간(평일 반복) 방식으로
계속 해석한다. 이 창은 **신규 매수 스캔**과(단타봇에 한해) **매도 판정 마감**을 동시에 규정한다.
장투봇은 1일 단위로 1~30일을 설정한다. `startAt`/`endAt`은 신규 매수 스캔 기간으로 쓰며,
`durationMinutes`는 매수 체결 시점부터 계산하는 한 거래의 최대 보유기간으로도 사용한다. 최소 24시간
전에는 모든 청산 신호를 무시하고, 24시간 이후에는 익절·손절·붕괴 신호를 평가한다. 신호가 없더라도
최대 보유기간에 도달하면 강제 매도한다.

개별 중지된 봇을 다시 시작할 때 기존 `endAt`이 이미 지났다면, 같은 `durationMinutes`로 현재 시점부터
새 스캔 창을 만든다.

이름은 생성 순서대로 종류 구분 없이 A, B, C...를 붙인다 — 예: `단타봇A`, `장투봇B`,
`단타봇C`. (`nextBotName`, `BOT_NAME_RE` 참고. 26개 초과 시 AA, AB... 스프레드시트 열 이름 방식.)

---

## 3. 진입 알고리즘 — 급등 탐지 스코어 (`scoreSurgeCandidates`, `surge.ts`)

3초(`SURGE_SCAN_INTERVAL_MS`)마다, `anyActive`(스캔 창이 활성인 봇이 하나라도 있을 때) 조건에서
전체 KRW 마켓을 스코어링해 대기 중인 봇에게 배정한다.

### 3.1 후보 편입 조건 (AND)

1. **유동성 필터**: 24시간 누적 거래대금 ≥ `config.minLiquidityKrw24h`(기본 10억 원)
2. **급등 필터**: 시장 전체 등락률 분포 대비 z-score ≥ `Z_THRESHOLD`(1.5)
   - `computeChangeRateZScores`: 전체 KRW 마켓의 24h 등락률 평균/표준편차로 z-score 계산
3. 이미 다른 봇에 배정된 마켓 제외

### 3.2 점수 공식

```
score = 100 × (0.45 × nChange + 0.30 × nAccel + 0.25 × nBid)
```

| 성분 | 원값 | 정규화 | 가중치 |
|---|---|---|---|
| 등락률(24h) | `changeRate24h` | `clamp(x / 0.10, 0, 1)` — +10% 이상 만점 | 0.45 |
| 체결대금 가속도 | `computeTradeValueAccel` — 최근30초/직전30초 체결대금 비율, [0,5] 클램프 | `clamp((accel-1)/4, 0, 1)` — 5배 이상 만점 | 0.30 |
| 매수 체결 비중 | `computeBidRatio` — 60초 이력 중 bid 체결 비중, [0,1] | `clamp((bid-0.5)×2, 0, 1)` — 매수 우위만 가점 | 0.25 |

- 등락률은 실제 09:00 시가 캔들 조회가 없어 24h 등락률로 대용한다(원문 설계의 한계 — §7 참고).
- 가속도/매수비중은 `history[market]`(60초 롤링 `TradeVolumeSnapshot` 이력)에서 계산한다.
  Tauri 체결 스트림이 없으면(브라우저 개발 모드) 이력이 비어 중립값(accel=1, bid=0.5)으로 처리된다.

### 3.3 배정

후보를 점수 내림차순으로 정렬한 뒤, 배정 가능한 봇(`scanning`/`idle`, 타깃 없음, 스캔 창 활성,
`inFlight` 아님)에게 순서대로 매칭한다. 점수가 `SCORE_THRESHOLD`(25) 미달이면 그 이후 후보는
정렬돼 있으므로 더 볼 필요 없이 배정을 멈춘다.

---

## 4. 청산 알고리즘

매 tick, `holding` 상태인 각 봇에 대해 아래 순서로 판정한다(`runTick`의 "보유 봇 익절/손절 판정" 루프).

```
1. 매도 판정이 열려 있는가?
   - 단타봇: 세션이 끝났는가? → 끝났으면 즉시 강제 매도(reason="timeout"), 종료
   - 장투봇: 매수 후 24시간이 지났는가? → 안 지났으면 이번 tick은 아무것도 안 함
2. 고정 익절: pnl ≥ takeProfitRate → 매도(reason="profit")
3. 고정 손절: pnl ≤ -stopLossRate → 매도(reason="loss")
4. 장투봇 최대 보유기간 도달 → 강제 매도(reason="timeout")
5. 붕괴 스코어 ≥ COLLAPSE_THRESHOLD(25) → 조기 매도(reason="signal")
```

pnl은 수수료 포함 실현 기준으로 계산한다:

```
pnl = (price × (1 - feeRate) - entryPrice × (1 + feeRate)) / entryPrice
```

### 4.1 고정 익절/손절

`BotSettings.takeProfitRate`/`stopLossRate`(예: +3%/-2%)로 사용자가 봇마다 지정한다. 두 지표는
하드 안전판이며, 3.과 4.보다 항상 먼저 확인한다.

### 4.2 붕괴 스코어 — 조기 매도 신호 (`scoreCollapse`, `surge.ts`)

고정 익절/손절 사이 구간에서, 추세가 꺾이는 조짐을 진입 스코어의 반전판으로 잡아낸다.
3개 지표를 진입 스코어와 반대로 해석하고 동일한 가중치를 쓴다.

```
collapseScore = 100 × (0.45 × nRetrace + 0.30 × nDecel + 0.25 × nAskDominance)
```

| 성분 | 원값 | 정규화 | 가중치 |
|---|---|---|---|
| 고점 대비 되돌림 | `retracement = max(0, (peakPrice - price) / peakPrice)` | `clamp(retrace / 0.015, 0, 1)` — 피크 대비 -1.5% 만점 | 0.45 |
| 체결대금 감속 | `accel`(위와 동일 함수) | `clamp((1-accel)/(1-0.3), 0, 1)` — 0.3배 이하로 급감 시 만점 | 0.30 |
| 매도 우위 전환 | `bidRatio`(위와 동일 함수) | `clamp((0.5-bid)×2, 0, 1)` — 매도 우위(bid<50%)만 가점 | 0.25 |

`peakPrice`는 `TradeBot.peakPriceSinceEntry` — 매수 이후 매 tick 갱신되는 관측 최고가다.
`collapseScore ≥ 25`(`COLLAPSE_THRESHOLD`)면 조기 매도한다. 단타봇은 세션 중, 장투봇은
최소 24시간을 넘긴 뒤부터만 이 판정이 적용된다(§2의 게이트를 이미 통과한 상태).

### 4.3 매도 사유(reason) 정리

| reason | 트리거 | 상태(state)는 실제 손익 부호로 결정 |
|---|---|---|
| `timeout` | 단타봇 세션 종료 또는 장투봇 최대 보유기간 도달 | `sold_profit`/`sold_loss` (부호 기준) |
| `profit` | 고정 익절 | `sold_profit` |
| `loss` | 고정 손절 | `sold_loss` |
| `signal` | 붕괴 스코어 임계값 초과 | `sold_profit`/`sold_loss` (부호 기준) |

---

## 5. 리스크 가드 (엔진 전역, `BotEngine` 내부 상태)

| 가드 | 기본값 | 동작 |
|---|---|---|
| 일일 손실 한도 | `dailyLossLimitKrw` = 50,000원 | KST 하루 누적 실현손익이 -50,000원 이하면 **신규 매수만** 중단(보유 포지션은 계속 모니터링/매도). 다음날 KST 자정에 리셋(`rolloverDailyIfNeeded`). |
| 최대 낙폭(MDD) | `maxDrawdownKrw` = 100,000원 | 누적 실현손익 고점 대비 낙폭이 100,000원 이상이면 `setEnabled(false)`로 **엔진 전체 정지**. |
| 연속 API 오류 | `maxConsecutiveApiErrors` = 3회 | 실거래 모드에서 주문/체결조회가 3회 연속 실패하면 엔진 전체 정지. 성공 시 카운터 리셋. |
| 주문 idempotency | `identifier` 필드 | 매수/매도 주문마다 `bot-{botId}-{buy|sell}-{uid}` 형태의 고유 identifier를 Upbit에 전달해, 같은 요청이 중복 전송돼도 거래소 측에서 중복 주문을 거부하도록 한다. |
| 수동 킬스위치 | `setEnabled(on)` | 로봇 매수봇 UI의 전체 on/off 토글. |
| 개별 신규진입 스위치 | `setBotEnabled(id, on)` | 로봇 상세 패널의 시작/중지. 중지 시 신규 매수만 막고 기존 포지션 청산 감시는 유지. |

리스크 가드 상태(`dailyPnlKrw`, `equityPeakKrw`, `consecutiveApiErrors` 등)는 **영속화하지
않는다** — 런타임 포지션과 동일하게 앱 재시작 시 초기화된다.

---

## 6. 데이터 로깅 — 시장 상황 대 수익결과 비교

거래를 반복하며 "어떤 시장 상황에서 진입한 거래가 잘 됐는지"를 나중에 분석할 수 있도록,
두 개의 CSV를 앱 실행 파일 옆(`ROOT/`)에 누적 기록한다. Tauri 데스크톱 앱에서만 기록되고
브라우저 개발 모드(`isTauri()===false`)에서는 조용히 스킵한다. 로그 기록 실패는 매매 자체를
막지 않는다.

### 6.1 `bot_trades_log.csv` — 매수/매도 체결 로그

매수 체결 성공 시, 매도 체결 성공 시 각각 1행씩 기록(`log_bot_trade` Tauri 커맨드).

```
timestamp,trade_id,bot_id,bot_name,action,market,name_ko,mode,price,volume,invested_krw,pnl_krw,pnl_rate,reason
```

- `action`: `buy` | `sell`
- `pnl_krw`/`pnl_rate`: 매수 행은 항상 빈 값, 매도 행에만 실현손익 기록
- `reason`: 매수는 항상 `buy`, 매도는 `profit`/`loss`/`timeout`/`signal`(§4.3)

### 6.2 `bot_market_log.csv` — 보유 중 시장 스냅샷 로그

봇이 `holding` 상태인 동안, 일정 주기로 그 순간의 시장 지표를 기록한다(`log_market_snapshot`
Tauri 커맨드). 샘플링 주기는 봇 종류별로 다르다(`MARKET_LOG_INTERVAL_MS`):

- 단타봇: 5초 — 세션이 짧아 촘촘한 해상도가 필요
- 장투봇: 60초 — 보유 기간이 길어(최소 24시간+) 촘촘히 남기면 로그가 과도하게 커짐

```
timestamp,trade_id,bot_id,bot_name,market,mode,price,pnl_rate,trade_value_accel,bid_ratio,collapse_score,retracement
```

- `trade_value_accel`/`bid_ratio`/`collapse_score`/`retracement`: §4.2 붕괴 스코어 계산에 쓰인
  원값 그대로 — 진입 당시부터 매도 시점까지 시장이 어떻게 변해왔는지 시계열로 남는다.

### 6.3 두 로그를 잇는 `trade_id`

매수 성공 시 `trade_id`(uid)를 하나 생성해 그 거래(매수~매도)가 끝날 때까지 봇에 들고 있다가
(`TradeBot.tradeId`), 매수 로그 행 / 시장 스냅샷 행들 / 매도 로그 행에 전부 같은 값을 남긴다.
분석 시 `bot_market_log.csv`를 `trade_id`로 그룹핑하면 그 거래 동안 시장이 어떻게 흘렀는지
시계열을 얻고, `bot_trades_log.csv`의 매도 행에서 같은 `trade_id`의 최종 `pnl_rate`를 붙이면
"이 시장 패턴 → 이 결과"로 바로 이어붙일 수 있다. 시간 범위로 조인할 필요가 없다.

두 로그 모두 **로테이션/용량 제한이 없다** — 개인 데스크톱 앱 기준으로는 무리 없는 크기지만,
장투봇을 며칠~몇 주씩 열어두면 `bot_market_log.csv`가 계속 자라난다는 점은 알아둔다.

---

## 7. 알려진 한계 (실거래 확대 전 검토 필요)

- **백테스트 인프라 없음**: 이 문서의 모든 임계값(`Z_THRESHOLD=1.5`, `SCORE_THRESHOLD=25`,
  `COLLAPSE_THRESHOLD=25`, `RETRACE_FULL=1.5%`, `DECEL_FULL=0.3배`, 익절/손절 기본값 등)은
  과거 데이터로 검증된 값이 아니라 추정값이다. §6의 로그가 쌓이면 이 값들을 데이터 기반으로
  재조정할 수 있다.
- **등락률이 후행지표**: 24h 등락률로 "시가 대비 상승"을 대신하고 있어(§3.2), 실제로는 이미
  많이 오른 뒤에 진입하게 될 수 있다.
- **슬리피지 미반영**: 수수료(`feeRate`)만 pnl 계산에 반영되고, 급등 추격 시장가 주문에서
  발생하는 슬리피지는 모델링돼 있지 않다.
- **최소 매도금액 사전 검증 없음**: 6,000원 예산은 업비트 최소 주문금액보다 완충이 있지만,
  약 16.7%를 넘는 급락에서는 평가 주문총액이 5,000원 아래로 내려가 청산 주문이 거부될 수 있다.
  실거래 확대 전 `orders/chance`와
  현재 평가금액을 이용한 주문 직전 검증 및 잔여자산 처리 정책이 필요하다.
- **캔들(분봉) 저장소 없음**: 60초 롤링 틱 이력만 메모리에 유지하므로, RSI/MACD 같은 정식
  기술지표는 지금 인프라로는 계산할 수 없다(붕괴 스코어는 이 한계를 피해 틱 이력만으로 계산하도록
  설계됨).
