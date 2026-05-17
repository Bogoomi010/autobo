# 편의 기능 구현 결과: 최근 선택 종목 바로가기

## 구현 내용

- `src/App.tsx`에 최근 선택 종목 저장 키와 로드/정제 로직을 추가했다.
- 선택 마켓이 실제 마켓 목록에 있는 유효 코드일 때 최근 목록 맨 앞에 추가하고 중복을 제거하도록 했다.
- 최근 목록은 최대 6개까지 `localStorage`에 저장한다.
- 상단 시세 영역 아래에 최근 선택 종목 버튼 줄을 추가했다.
- 최근 선택 종목을 비우는 버튼과 로그 메시지를 추가했다.
- `src/App.css`에 최근 종목 영역, 버튼, 모바일 배치 스타일을 추가했다.

## 보안 범위

- 저장 대상은 마켓 코드 목록뿐이다.
- API Key, 계좌 정보, 주문 응답, 로그, 자동 감시 실행 상태는 저장하지 않는다.

## 검증 결과

- `npm run build`: 통과
  - 현재 worktree는 의존성 확인을 위해 `node_modules` junction을 사용하면 Vite config 로딩 권한 오류가 발생해, 동일 변경 파일을 `D:\Workspace\repo_autobo\.automation-build\a991-recent-markets` 임시 빌드 디렉터리로 복사한 뒤 원래 명령으로 검증했다.
- `tauri build --no-bundle`: 통과
  - `beforeBuildCommand`는 위 `npm run build`로 이미 검증한 `dist`를 사용하도록 임시 override 파일에서 비워 실행했다.
  - 생성 파일: `D:\Workspace\repo_autobo\.automation-build\a991-recent-markets\src-tauri\target\release\autobo.exe`

## 비고

- 이 환경의 기본 `npm` shim은 사용자 Roaming 경로의 누락된 npm CLI를 참조했다.
- 검증 시 `npm_config_prefix=C:\Program Files\nodejs`를 지정해 Node 설치 경로의 npm CLI를 사용했다.
