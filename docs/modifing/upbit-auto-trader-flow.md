# Upbit 자동 트레이딩 앱 동작 흐름

## 화면 진입

`src/App.tsx`는 앱 시작 시 기본 마켓 `KRW-BTC`를 기준으로 현재가 조회를 호출한다. 시세 조회는 인증이 필요하지 않으며 Rust 명령 `get_ticker`가 Upbit `/v1/ticker`로 요청한다.

## API Key 입력

사용자가 Access Key와 Secret Key를 입력하면 값은 React 상태에만 유지된다. 파일 저장이나 로컬 스토리지 저장은 하지 않는다. 잔고 조회, 주문 가능정보 조회, 실주문 전송 시에만 Tauri invoke 인자로 Rust 백엔드에 전달된다.

## 인증 처리

`src-tauri/src/lib.rs`는 인증이 필요한 요청마다 새 UUID nonce를 만들고 `HS512` JWT를 생성한다. GET 쿼리 또는 POST 본문이 있는 요청은 Upbit 문서 기준에 맞춰 쿼리 문자열을 만든 뒤 SHA-512 해시를 `query_hash`에 넣는다.

## 자동 전략

프론트엔드 자동 감시 루프는 설정된 주기마다 현재가를 갱신한다. 현재가가 매수 기준가 이하이면 `bid` + `ord_type=price` 주문을 만든다. 현재가가 매도 기준가 이상이면 `ask` + `ord_type=market` 주문을 만든다. 중복 주문을 줄이기 위해 쿨다운 시간이 지나기 전에는 새 주문을 만들지 않는다.

## 주문 실행

모의 실행이 켜져 있으면 Rust 명령 `place_order`는 주문 유효성만 확인하고 Upbit로 전송하지 않는다. 모의 실행이 꺼져 있으면 `/v1/orders`에 JSON 본문을 전송한다. 응답은 화면의 최근 응답 영역과 로그에 표시된다.

## 검증 결과

- `npm run build`
- `cargo check` in `src-tauri`
