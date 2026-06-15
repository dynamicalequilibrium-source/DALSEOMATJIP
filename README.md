# 🍽️ 달서맛집 (DALSEOMATJIP) v2

대구광역시 달서구 AI 맛집 분석 플랫폼

## 아키텍처

```
네이버 플레이스/블로그 크롤링
        ↓ (Playwright)
   Firestore DB
   (restaurants / trends / briefings)
        ↓
  Claude AI 에이전트 (매일 자동실행)
  - 신규 식당 감지
  - 핫플 스코어링
  - 리뷰 진정성 필터
  - 데일리 브리핑 생성
        ↓
  Express API 서버 (/api/*)
        ↓
  React 앱 (4탭 대시보드)
  - 대시보드 / 신규맛집 / 랭킹 / AI채팅
```

## 환경변수 설정

`.env.local` 파일 생성:

```env
ANTHROPIC_API_KEY=sk-ant-...
VITE_FIREBASE_API_KEY=...
```

GitHub Secrets 등록:
- `ANTHROPIC_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT` (JSON 전체)

## 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버 (프론트엔드)
npm run dev

# API 서버 (별도 터미널)
npm run server:dev

# 크롤러 실행
cd crawler
pip install -r requirements.txt
playwright install chromium
python naver_crawler.py --target all

# AI 에이전트 실행
cd agent
pip install -r requirements.txt
python main.py
```

## GitHub Actions 자동화

`.github/workflows/daily_agent.yml`
- 매일 09:00 KST: 크롤링 → Claude 분석 → 브리핑 저장
- 매일 18:00 KST: 저녁 데이터 업데이트
- 수동 실행 가능 (`workflow_dispatch`)

## 크롤러 타겟 목록 추가

`crawler/naver_crawler.py`의 `PLACE_TARGETS` 배열에 네이버 플레이스 ID와 식당명 추가:

```python
PLACE_TARGETS = [
    {"placeId": "네이버플레이스ID", "name": "식당명", "dong": "행정동"},
    ...
]
```

네이버 플레이스 URL에서 ID 확인: `https://m.place.naver.com/restaurant/[ID]/`

## Firestore 컬렉션 구조

- `restaurants/{placeId}` — 식당 마스터 데이터
- `trends/{placeId}` — 일별 트렌드 스냅샷
- `briefings/{YYYY-MM-DD}` — AI 데일리 브리핑

## 기술 스택

- **프론트엔드**: React 19 + TypeScript + Tailwind CSS v4
- **AI**: Anthropic Claude Sonnet (claude-sonnet-4-6)
- **DB**: Firebase Firestore
- **크롤러**: Python + Playwright + fake-useragent
- **API 서버**: Node.js + Express
- **배포**: Netlify (프론트) + GitHub Actions (자동화)
