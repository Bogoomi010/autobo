# BTC 자동투자봇 개발용 AI Agent Context

version: v2-ai-optimized
purpose: Claude, Codex App, 또는 다른 코드 에이전트가 첨부 자료를 읽고 비트코인 자동투자봇 설계/구현 작업을 더 정확하게 수행하도록 만든 실행 지침입니다.
source: Successful Algorithmic Trading 선별 PDF. 이 문서는 원문 예제를 그대로 복사해 구현하라는 뜻이 아니라, BTC 현물 자동투자봇에 맞게 변환할 설계 참고자료입니다.
use_scope: 기술 설계, 백테스트, 데이터 저장, 리스크 관리, 모의투자, 실행 엔진 구현 참고용. 특정 매수/매도 추천이나 수익 보장 용도가 아닙니다.

---

## 1. 에이전트가 먼저 이해해야 할 핵심

이 프로젝트의 목표는 "비트코인 가격을 맞히는 마법의 예측기"가 아니라, **검증 가능한 BTC 현물 자동투자 시스템**을 만드는 것입니다. 가장 중요한 결과물은 전략 자체보다 다음 구조입니다.

- 데이터 수집 및 저장: OHLCV, 실시간 체결, 호가, 주문, 체결, 잔고, API 오류 로그를 분리 저장합니다.
- 백테스트: 과거 데이터를 한 번에 보지 않고 시간순으로 흘려보내 look-ahead bias를 막습니다.
- 비용 모델: 거래소 maker/taker 수수료, 스프레드, 슬리피지, 최소 주문금액, 부분체결을 반영합니다.
- 전략: DCA를 기준 전략으로 두고 이동평균 필터, 변동성 필터, 예측 모델은 단계적으로 붙입니다.
- 리스크: 최대 일일 손실, 최대 누적 낙폭, 과매매 제한, API 실패 횟수, 수동 킬스위치를 둡니다.
- 성과 측정: 총수익률만 보지 말고 BTC 단순보유 대비 초과수익, MDD, Sharpe/Sortino, 수수료 총액을 함께 봅니다.
- 최적화: 가장 수익률 높은 파라미터 하나가 아니라 여러 기간에서 안정적인 파라미터 영역을 찾습니다.

---

## 2. 기본 가정

사용자가 별도로 지정하지 않았다면 다음을 기본값으로 둡니다.

- 자산: BTC 현물만 대상으로 합니다.
- 레버리지: 사용하지 않습니다.
- 숏 포지션: 사용하지 않습니다.
- 거래 모드: dry-run 또는 paper trading을 기본값으로 합니다.
- 실거래: 사용자가 명시적으로 허용하기 전까지 절대 활성화하지 않습니다.
- 거래소: 사용자가 지정하지 않았다면 거래소 어댑터 인터페이스만 설계하고, 특정 거래소 구현은 분리합니다.
- 기준 전략: BTC 단순보유, 현금 보유, 단순 DCA를 벤치마크로 둡니다.
- 전략 MVP: DCA + 장기 이동평균 필터 + 변동성 기반 매수금액 조절을 우선 구현합니다.
- 언어/스택: 기존 저장소가 있으면 그 구조를 따릅니다. 새 프로젝트라면 Python + SQLite/PostgreSQL + pytest 기반을 우선 제안합니다.

---

## 3. 비목표와 금지사항

- 원문 PDF의 주식, ETF, Interactive Brokers 예제를 그대로 붙여 넣지 않습니다.
- Yahoo Finance, S&P500, SPY, AAPL 중심의 코드는 BTC/KRW 또는 BTC/USDT 거래소 데이터 구조로 바꿔야 합니다.
- 252거래일 기준 연환산을 BTC 24시간 365일 시장에 그대로 적용하지 않습니다.
- 수익률만 보고 전략을 선택하지 않습니다.
- 수수료, 스프레드, 슬리피지, 최소 주문금액, 부분체결 없는 백테스트 결과를 실거래 가능 결과로 취급하지 않습니다.
- API 키를 코드, 로그, 문서, 테스트 fixture에 하드코딩하지 않습니다.
- 실거래 주문 기능은 dry-run, idempotency, 주문 중복 방지, kill switch, 잔고 검증이 없으면 구현 완료로 보지 않습니다.

---

## 4. 권장 아키텍처

```text
btc-bot/
  config/
    settings.example.yml
  src/
    data/
      exchange_data_handler.py      # 캔들/체결/호가 수집
      storage.py                    # DB 저장/조회
      validators.py                 # 누락, 중복, 이상치 검사
    events/
      event.py                      # MARKET, SIGNAL, ORDER, FILL, RISK, ERROR
      queue.py
    strategy/
      base.py
      dca.py
      ma_filter.py
      volatility_sizing.py
    portfolio/
      portfolio.py                  # 현금/BTC 잔고, 평가금액, 포지션
      position_sizer.py             # 매수 금액/수량 계산
    risk/
      risk_manager.py               # 일일 손실, MDD, API 실패, 킬스위치
      guards.py
    execution/
      exchange_adapter.py           # 거래소 추상 인터페이스
      paper_execution.py
      live_execution.py             # 기본 비활성화
    backtest/
      engine.py                     # 이벤트 기반 백테스트 루프
      cost_model.py                 # 수수료/슬리피지/스프레드
      metrics.py                    # 수익률/MDD/Sharpe/Sortino
    reports/
      performance_report.py
  tests/
    test_no_lookahead.py
    test_cost_model.py
    test_risk_manager.py
    test_order_idempotency.py
    test_backtest_regression.py
```

핵심 흐름은 다음과 같습니다.

```text
MarketEvent -> Strategy -> SignalEvent -> Portfolio/Risk -> OrderEvent -> Execution -> FillEvent -> Portfolio Update
```

백테스트와 실거래가 같은 전략 코드, 같은 포트폴리오 코드, 같은 리스크 코드를 사용하도록 구성합니다. 차이는 DataHandler와 ExecutionHandler만 교체하는 방식이 가장 좋습니다.

---

## 5. 개발 순서

### Phase 1 - 저장소 점검 및 설계

1. 현재 저장소 구조와 사용 언어를 확인합니다.
2. 실거래소, 기준 통화, 주문 방식, 투자 주기, 최소 주문금액이 코드나 문서에 있는지 찾습니다.
3. 없으면 기본 가정으로 진행하되, 거래소 종속 구현은 추상화합니다.
4. README 또는 docs에 현재 설계와 결정사항을 기록합니다.

### Phase 2 - 데이터 계층

1. OHLCV 저장 테이블을 만듭니다.
2. 체결, 호가, 주문, 체결결과, 잔고, API 오류 로그를 별도 테이블로 둡니다.
3. 데이터 누락, 중복 timestamp, 비정상 가격 spike를 검증합니다.
4. 백테스트 데이터는 항상 시간순 iterator로만 공급합니다.

### Phase 3 - 이벤트 기반 백테스트

1. Event 타입을 정의합니다.
2. HistoricalDataHandler가 한 번에 하나의 bar만 흘려보내도록 만듭니다.
3. Strategy는 DataHandler가 제공한 현재까지의 데이터만 사용합니다.
4. Portfolio는 SignalEvent를 OrderEvent로 바꾸기 전에 리스크와 잔고를 확인합니다.
5. SimulatedExecutionHandler는 수수료, 스프레드, 슬리피지, 최소 주문금액, 부분체결을 반영합니다.

### Phase 4 - 기준 전략과 벤치마크

1. 현금 100% 보유.
2. BTC 단순보유.
3. 단순 DCA.
4. DCA + 장기 이동평균 필터.
5. DCA + 변동성 기반 매수금액 조절.

전략이 좋아 보이려면 최소한 BTC 단순보유와 단순 DCA를 비용 반영 후 넘어야 합니다.

### Phase 5 - 성과 리포트

필수 지표:

- 총수익률
- CAGR 또는 365일 기준 연환산 수익률
- BTC 단순보유 대비 초과수익
- 단순 DCA 대비 초과수익
- MDD
- Drawdown duration
- Sharpe Ratio
- Sortino Ratio
- 거래 횟수
- 승률
- 평균 이익 / 평균 손실
- 수수료 총액
- 슬리피지 추정액
- 월별 수익률

### Phase 6 - 리스크 관리

필수 방어 규칙:

- 하루 손실 한도 초과 시 신규 주문 중단
- 계좌 고점 대비 MDD 한도 초과 시 봇 정지
- API 오류 연속 발생 시 봇 정지
- 주문 응답 불일치 시 봇 정지
- 중복 주문 방지 idempotency key 적용
- 수동 kill switch 적용
- 실거래 모드는 기본 OFF
- API 키는 환경변수 또는 secret manager로만 로드

### Phase 7 - 최적화와 검증

1. Grid Search는 사용 가능하지만, 가장 좋은 단일 조합을 바로 채택하지 않습니다.
2. train/test split, walk-forward, 구간별 검증을 수행합니다.
3. 파라미터 주변 영역이 안정적인지 봅니다.
4. 수수료/슬리피지를 보수적으로 높여도 무너지지 않는지 확인합니다.
5. 과거 특정 상승장에만 맞춘 파라미터는 탈락시킵니다.

### Phase 8 - 모의투자와 실거래 준비

1. 실제 거래소 API를 붙이더라도 주문 전송은 paper execution으로 먼저 검증합니다.
2. 실시간 신호와 백테스트 신호가 같은 조건에서 일치하는지 확인합니다.
3. 잔고 조회, 주문 생성, 주문 취소, 부분체결, 체결 조회, 장애 복구를 테스트합니다.
4. 소액 실거래 전에는 kill switch와 주문 중복 방지가 반드시 통과해야 합니다.

---

## 6. 테스트 요구사항

최소 테스트는 다음을 포함해야 합니다.

- `test_no_lookahead`: 전략이 미래 bar를 읽지 못하는지 검증합니다.
- `test_cost_model`: maker/taker 수수료, 스프레드, 슬리피지가 포트폴리오에 반영되는지 검증합니다.
- `test_min_order_size`: 최소 주문금액 미만 주문이 차단되는지 검증합니다.
- `test_partial_fill`: 부분체결 후 잔고와 평균단가가 맞는지 검증합니다.
- `test_api_failure_halts_trading`: API 오류 연속 발생 시 신규 주문이 중단되는지 검증합니다.
- `test_kill_switch`: kill switch가 켜졌을 때 모든 신규 주문이 차단되는지 검증합니다.
- `test_order_idempotency`: 같은 신호가 반복 처리되어도 중복 주문이 발생하지 않는지 검증합니다.
- `test_metrics`: MDD, Sharpe, Sortino, 수수료 총액 계산이 맞는지 검증합니다.

---

## 7. Claude에게 첨부할 때 사용할 프롬프트

```text
첨부한 PDF/MD는 비트코인 자동투자봇 개발을 위한 AI Agent 최적화 참고문서다.

목표:
- 원문 주식/ETF 예제를 그대로 복사하지 말고, BTC 현물 자동투자봇에 맞게 변환한다.
- 우선순위는 전략 수익률보다 데이터 정확도, 이벤트 기반 백테스트, 비용 모델, 리스크 관리, 모의투자 안전성이다.

작업 방식:
1. 먼저 현재 저장소 구조를 분석한다.
2. 이미 있는 파일/설계를 존중해서 최소 변경으로 개선한다.
3. 거래소가 명시되어 있지 않으면 exchange adapter 인터페이스부터 만든다.
4. 실거래 주문은 기본 비활성화하고 dry-run/paper trading을 우선 구현한다.
5. 수수료, 스프레드, 슬리피지, 최소 주문금액, 부분체결 없는 백테스트는 완료로 보지 않는다.
6. 결과물은 설계 요약, 변경 파일 목록, 테스트 방법, 남은 리스크 순서로 보고한다.

먼저 구현하지 말고, 이 문서 기준으로 현재 프로젝트에 부족한 부분과 1차 구현 계획을 제시해라.
```

---

## 8. Codex App에 넣을 때 사용할 프롬프트

```text
Read `BTC_BOT_AGENT_CONTEXT.md` first. Treat it as the project-level implementation guide.

Task:
Inspect the repository and propose a minimal, safe implementation plan for a BTC spot auto-investment bot.

Hard requirements:
- Do not enable live trading by default.
- Implement dry-run or paper trading first.
- Keep exchange-specific code behind an ExchangeAdapter interface.
- Backtesting must be event-driven or time-sequential to avoid look-ahead bias.
- Include fees, spread/slippage, minimum order size, and partial fill handling in the simulation model.
- Add risk guards: daily loss limit, max drawdown halt, API failure halt, duplicate order prevention, manual kill switch.
- Add tests for no-lookahead, cost model, risk guards, idempotency, and metrics.
- Do not hardcode API keys or secrets.

Output:
1. Brief architecture summary.
2. Files to create or modify.
3. Implementation steps in small commits.
4. Tests to add.
5. Any assumptions or missing information.

Start by reading the existing codebase. Do not make large rewrites unless necessary.
```

---

## 9. 원본 선별 PDF 사용 지도

- 백테스트 현실화: 원본 PDF 페이지 24-29. 비용, 편향, 주문 타입, 슬리피지, 시장충격을 참고합니다.
- 자동 실행 구조: 원본 PDF 페이지 30-36. 연구용 백테스터와 이벤트 기반 백테스터, VPS/서버 실행을 참고합니다.
- 전략 평가와 데이터 조건: 원본 PDF 페이지 43-46. 수익률보다 Sharpe, MDD, 벤치마크를 먼저 봅니다.
- 데이터 저장/정확도/자동화: 원본 PDF 페이지 56-60. DB 저장, 데이터 품질, 자동화 구조를 참고합니다.
- 데이터 빈도와 호가/체결 데이터: 원본 PDF 페이지 72-74, 83. 1분봉, 틱, 오더북 저장 판단에 사용합니다.
- 시계열 검정: 원본 PDF 페이지 96-100. ADF, Hurst를 추세/횡보 판단 보조 지표로만 사용합니다.
- 예측 모델: 원본 PDF 페이지 106-108, 112-115. 직접 매매 신호보다 보조 필터로 사용합니다.
- 성과 측정: 원본 PDF 페이지 118-127. Equity curve, Sharpe, Sortino, CALMAR, MDD를 참고합니다.
- 리스크와 자금관리: 원본 PDF 페이지 128-135. 전략 리스크, 운영 리스크, Kelly, VaR를 참고하되 BTC에서는 보수적으로 적용합니다.
- 이벤트 기반 엔진: 원본 PDF 페이지 138-164. Market/Signal/Order/Fill, DataHandler, Strategy, Portfolio, ExecutionHandler, Backtest 구조를 봇의 뼈대로 사용합니다.
- 전략 구현 예시: 원본 PDF 페이지 172-181, 188-189. 이동평균 예시와 성과 그래프를 BTC 데이터로 바꿔 실험합니다.
- 파라미터 최적화: 원본 PDF 페이지 190-207. Grid Search, cross validation, overfitting 방지를 참고합니다.

---

## 10. 완료 기준

에이전트가 작업을 완료했다고 말하려면 다음을 만족해야 합니다.

- 저장소에서 실행 가능한 테스트 명령을 제공합니다.
- 백테스트 결과가 수수료/슬리피지 반영 전후로 분리되어 표시됩니다.
- BTC 단순보유, 단순 DCA와 비교됩니다.
- 리스크 중단 조건이 실제 주문 생성 전에 적용됩니다.
- 주문/체결/잔고 로그가 재현 가능하게 저장됩니다.
- 실거래 기능은 명시적 설정 없이는 켜지지 않습니다.
- API 키와 민감정보가 저장소에 포함되지 않습니다.
- 남은 가정과 위험을 숨기지 않고 보고합니다.
