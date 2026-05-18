# 편의 기능 구현 결과: 수동 주문 템플릿

## 구현 내용

- 수동 주문 패널에 템플릿 이름 입력과 저장 버튼을 추가했다.
- 현재 수동 주문 폼의 market, side, ord_type, price, volume, time_in_force 값을 템플릿으로 저장하도록 했다.
- 저장된 템플릿은 최대 5개까지 `localStorage`의 `autobo.manualOrderTemplates.v1` 키에 보관한다.
- 같은 이름으로 저장하면 기존 템플릿을 최신 값으로 덮어쓰고 목록 최상단으로 올린다.
- 템플릿 목록에서 불러오기와 삭제를 할 수 있게 했다.
- 템플릿을 불러올 때 저장된 market도 선택 종목에 반영하고, identifier는 현재 입력값을 유지한다.

## 보안 및 안전 범위

- identifier는 중복 주문 식별자 재사용을 피하기 위해 저장하지 않는다.
- Access Key, Secret Key, 계좌 응답, 주문 응답, 로그, 자동 감시 실행 상태는 저장하지 않는다.
- 템플릿은 브라우저 로컬 저장소에만 저장된다.

## 검증 결과

- `node node_modules\typescript\bin\tsc --project tsconfig.json`: 통과
- `npm run build`: 통과
  - 현재 worktree 경로에서는 Vite/esbuild가 샌드박스 밖 상위 디렉터리를 읽으려 해 차단되므로, 같은 소스를 `D:\Workspace\repo_autobo\.automation-build\automation-3-5088`에 복사해 `npm --prefix ... run build`로 검증했다.
- `cargo check --manifest-path src-tauri\Cargo.toml`: 통과
- Vite 개발 서버를 임시 빌드 복사본에서 실행해 `http://127.0.0.1:5174` HTTP 200 응답을 확인했다.

## 비고

- 첫 npm 설치 시 기본 npm 캐시/로그 경로 문제와 샌드박스 경로 제약이 있어, 원본 작업 디렉터리의 의존성을 현재 worktree에 복사해 검증했다.
