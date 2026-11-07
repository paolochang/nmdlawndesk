# DEMO: Lawn Desk

flue, flue/react, cloudflare

## 누구를 위한 에이전트이고, 어떤 업무를 대신하는지

**Dave를 위한 에이전트다.** Dave는 동네 잔디 깎기 서비스를 혼자 운영하는 가상의 1인 자영업자다. 오전 내내 잔디를 깎는데, 잔디깎이 소음 때문에 작업 중에는 전화도 문자도 받지 못해서 일이 끝난 뒤 몰아서 답한다.

**에이전트는 Dave 대신 손님 문자에 답한다.**
- 손님 문자에서 이름, 주소, 동네, 마당 크기를 뽑고, 빠진 것만 되묻는다.
- Dave의 요금 규칙대로 견적을 안내한다.
- Dave가 그 동네에 가는 요일 중 빈 시간 두 개를 제안한다.
- 손님이 고른 시간으로 예약을 잡는다.
- 스스로 정할 수 없는 문의는 Dave에게 넘긴다: 서비스 지역 밖, 1 acre 넘는 마당, 불만, 환불, 가격 흥정.

데모는 실제 SMS 대신 웹 문자 시뮬레이터로 만든다. 전화번호 없이 브라우저에서 바로 테스트할 수 있다.

## 진행 상황

feature를 merge할 때마다 갱신한다.

**지금 되는 것**
- Cloudflare Worker 두 개로 나눴다. `backend/`는 Workers AI로 Flue 에이전트를 돌리고, `frontend/`는 React chat 화면을 띄우고 `/api/*`를 service binding으로 backend에 넘긴다.
- 에이전트 응답은 스트리밍으로 돌아온다(curl이나 Flue client로 확인. 브라우저 chat 화면은 아래 "아직 안 되는 것" 참고).
- Dave의 업무 규칙을 코드로 만들고 테스트했다(`backend/src/domain/`, 테스트 68개):
  - 근무 시간 8 AM-1 PM, 동네별 근무 요일, 시간당 $45 요금표
  - 견적: ½ acre 이하 1시간 $45, 1 acre 이하 1.5시간 $67.50, 1 acre 초과는 Dave에게 넘김, 크기를 모르면 1시간 견적 후 현장에서 조정
  - 빈 시간 찾기: 그 동네 근무 요일에 30분 단위로, 1 PM 전에 끝나고 기존 예약과 겹치지 않는 시간
  - 테스트용 예약 일정 4종(seed preset)
- 방문자별 예약 달력을 만들었다(`backend/src/store/`, 테스트 25개). 방문자마다 Durable Object 하나가 자기 달력을 갖는다.
  - 처음 열면 테스트용 예약 일정 4종 중 하나로 시작한다.
  - 예약을 추가할 때 겹치는 시간, 규칙에 어긋나는 시간, 이름 없는 예약을 거부한다. 가격은 저장소가 마당 크기로 직접 계산한다.
  - reset하면 새 generation으로 바뀌고, 지금과 다른 일정으로 다시 시작한다.
  - `GET /api/config`(Dave의 규칙), `GET /api/calendar/<visitorId>`, `POST /api/calendar/<visitorId>/reset`
- 리뷰어 로그인을 만들었다(`backend/src/auth/`, 테스트 42개).
  - 공유 access code와 닉네임으로 로그인하면 2시간짜리 서명 token을 준다(`POST /api/auth`).
  - 닉네임은 정규화(대소문자, 앞뒤 공백, 보이지 않는 문자)한 뒤 HMAC으로 바꿔 allowlist(Workers KV)와 비교한다. 닉네임 목록 원문은 repo에 넣지 않고, `scripts/allowlist.ts`로 바꾼 값만 KV에 넣는다.
  - 같은 닉네임은 어느 브라우저에서 들어와도 같은 `visitorId`와 같은 달력을 쓴다.
  - 달력과 에이전트 route는 token이 없거나 만료되면 401, 다른 방문자 것이면 403, 5분에 쓰기 30번을 넘으면 429를 준다.
- `backend/README.md`, `frontend/README.md`에 로컬 실행 방법을 적었다: 설치, `.dev.vars`와 로컬 allowlist 준비, dev server(backend 8787을 먼저, 그다음 frontend 5180), 로그인과 token을 쓰는 curl.

**아직 안 되는 것**
- 에이전트는 아직 placeholder다. 위 규칙과 달력이 아직 에이전트에 연결되지 않아서, 요금이나 일정을 물으면 모른다고 답한다.
- 에이전트 tool(견적, 빈 시간 찾기, 예약), Dave에게 넘기기
- 브라우저 chat 화면: 로그인 화면이 아직 없어서 메시지를 보내면 401을 받는다. 로그인 화면이 붙으면 다시 된다.
- 로그인 시도 횟수 제한: 닉네임은 공개라서 access code가 유일한 장벽이다. 공개 배포 전에 추가한다.
- 문자 시뮬레이터 화면: 손님 폰, Dave 폰, 달력, 요금표
- production 배포
