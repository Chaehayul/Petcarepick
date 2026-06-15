# Petcarepick

반려동물 프로필과 일상 건강 기록을 기반으로 맞춤 영양 추천, 건강 리포트,
위치 기반 동물병원 검색, 일정 관리, AI 헬스 상담을 제공하는 펫 헬스케어 플랫폼입니다.

## Architecture

```text
Petcarepick/
├─ frontend/                 # 반응형 PWA, Netlify 배포
│  ├─ assets/
│  ├─ src/
│  └─ .env.example
├─ backend/                  # Express + TypeScript REST API, Render 배포
│  ├─ prisma/
│  │  ├─ migrations/
│  │  └─ schema.prisma
│  ├─ src/
│  │  ├─ app.ts
│  │  ├─ auth.ts
│  │  ├─ db.ts
│  │  ├─ external.ts
│  │  └─ server.ts
│  ├─ tests/
│  └─ .env.example
├─ netlify.toml
└─ render.yaml
```

## Backend stack

- Express 5, TypeScript, Zod
- PostgreSQL, Prisma ORM
- JWT access token, refresh token rotation, bcrypt
- Helmet, CORS allowlist, rate limiting, request ID logging
- OpenAI Responses API
- OpenStreetMap Overpass API, Kakao Local API fallback
- Vitest, Supertest

## Local development

```powershell
npm install
Copy-Item backend/.env.example backend/.env
npm run dev:backend
```

새 터미널에서 프론트엔드를 실행합니다.

```powershell
npm run dev:frontend
```

- Frontend: `http://localhost:4173`
- Backend health: `http://localhost:8787/api/health`
- OpenAPI document: `http://localhost:8787/api/openapi.json`

## Environment variables

```env
PORT=8787
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:4173

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
JWT_SECRET=replace-with-a-long-random-secret
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_DAYS=30

OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_REPORT_MODEL=gpt-5.5
OPENAI_STORE_RESPONSES=false

MAP_PROVIDER=openstreetmap
KAKAO_REST_API_KEY=
```

`DATABASE_URL`이 없으면 AI와 병원 검색 API는 계속 실행되고, 인증 및 데이터 저장 API만
`503 DATABASE_NOT_CONFIGURED`를 반환합니다. 배포 시 PostgreSQL 연결 문자열을 등록하면
Prisma 마이그레이션이 자동 적용됩니다.

## Main API

- `POST /api/auth/signup`, `POST /api/auth/login`
- `POST /api/auth/refresh`, `POST /api/auth/logout`
- `GET /api/users/me`
- `GET|POST|PATCH|DELETE /api/pets`
- `GET|POST /api/pets/:petId/records`
- `PATCH|DELETE /api/records/:recordId`
- `GET|POST /api/pets/:petId/events`
- `PATCH|DELETE /api/events/:eventId`
- `POST /api/pets/:petId/feedback`
- `POST /api/ai/chat`
- `POST /api/reports/health`
- `POST /api/hospitals/nearby`

## Verification

```powershell
npm run check
npm test
```

## Deployment

- Frontend: Netlify, publish directory `frontend`
- Backend: Render, root directory `backend`
- Database: PostgreSQL-compatible managed database such as Neon
- Secrets are configured only in Netlify or Render environment variables.
