# Autobo

Tauri 기반 Upbit 자동 트레이딩 데스크톱 앱입니다. 현재 구현은 MVP이며 기본값은 주문 모의 실행입니다.

## 기능

- Upbit `KRW-*` 마켓 현재가 조회
- API Key 기반 잔고 조회 및 주문 가능정보 조회
- 지정가, 시장가 매수, 시장가 매도 수동 주문
- 가격 조건 기반 자동 감시
- 체결/호가 기반 틱 신호 자동 전략 dry-run 검증
- 주문 모의 실행 기본 활성화
- API Key 파일 저장 없음

## 실행

```powershell
npm install
npm run tauri dev
```

웹 UI만 확인하려면 다음 명령을 사용할 수 있습니다. 브라우저에서는 Tauri Rust 명령이 없으므로 API 호출 기능은 데스크톱 앱에서 확인해야 합니다.

```powershell
npm run dev
```

## 빌드 검증

```powershell
npm run tauri build
```

## Upbit API 사용 범위

- 시세 조회: `GET /v1/ticker?markets=KRW-BTC`
- KRW 마켓 현재가 목록: `GET /v1/ticker/all?quote_currencies=KRW`
- KRW 마켓 실시간 체결량: `wss://api.upbit.com/websocket/v1`의 `trade` 구독
- 선택 마켓 실시간 호가: `wss://api.upbit.com/websocket/v1`의 `orderbook` 구독
- 잔고 조회: `GET /v1/accounts`
- 주문 가능정보: `GET /v1/orders/chance?market=KRW-BTC`
- 주문 생성: `POST /v1/orders`
- 인증: JWT `HS512`, `access_key`, `nonce`, 요청 파라미터 또는 본문이 있을 때 `query_hash` 및 `query_hash_alg=SHA512`

## 실거래 전 확인

- Upbit API Key에 필요한 권한만 부여했는지 확인합니다.
- 허용 IP가 현재 실행 환경과 일치하는지 확인합니다.
- 모의 실행으로 주문 본문과 조건 트리거를 먼저 검증합니다.
- 틱 신호 전략은 현재 dry-run 전용이며, 실거래 연결 전 주문 상태 추적과 미체결 취소 흐름을 별도로 검증해야 합니다.
