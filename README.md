# Petcarepick

반려동물 프로필과 일상 기록을 기반으로 맞춤 영양 추천, 건강 리포트, 위치 기반 동물병원 검색, AI 헬스 매니저를 제공하는 모노레포입니다.

## 구조

```text
Petcarepick/
├─ frontend/                 # 반응형 웹/PWA
│  ├─ assets/
│  ├─ src/
│  ├─ .env.example
│  └─ package.json
├─ backend/                  # 비밀 키와 외부 API 연동
│  ├─ src/server.js
│  ├─ .env
│  ├─ .env.example
│  └─ package.json
├─ package.json
└─ netlify.toml
```

## 로컬 실행

터미널 1:

```powershell
npm run dev:backend
```

터미널 2:

```powershell
npm run dev:frontend
```

- 프런트엔드: `http://localhost:4173`
- 백엔드 상태 확인: `http://localhost:8787/api/health`

## 환경변수

`frontend/.env.example`에는 브라우저에 공개 가능한 값만 둡니다.

`backend/.env`에는 다음 비밀 키를 둡니다.

```env
PORT=8787
FRONTEND_ORIGIN=http://localhost:4173
KAKAO_REST_API_KEY=
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_REPORT_MODEL=gpt-5.5
OPENAI_STORE_RESPONSES=false
```

`OPENAI_API_KEY`와 `KAKAO_REST_API_KEY`는 프런트엔드 코드에 넣지 않습니다.

## API

- `GET /api/health`: 서버 상태
- `POST /api/hospitals/nearby`: 사용자 좌표 기준 카카오 동물병원 검색
- `POST /api/ai/chat`: 반려동물 프로필과 기록 기반 AI 상담
- `POST /api/reports/health`: AI 건강 리포트 생성

## 배포

- 프런트엔드: Netlify에서 저장소 루트를 연결하면 `netlify.toml`이 `frontend/`를 배포합니다.
- 백엔드: Render 또는 Railway에서 Root Directory를 `backend`로 지정하고 `npm run dev`를 실행합니다.
- 운영 프런트의 API 주소는 배포된 백엔드 URL로 설정합니다.
