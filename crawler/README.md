# 네이버 지도 데이터 크롤러 (Python)

이 폴더는 대구시 달서구 등 특정 지역의 네이버 지도 플레이스 리뷰 데이터를 수집하기 위한 Python 기반 브라우저 자동화 크롤러입니다.

## 아키텍처 개요 (Data Ingestion)
- **Playwright**: 동적 페이지(AJAX/React) 렌더링 후의 데이터를 크롤링하기 위해 사용됩니다.
- **순환 Proxy 및 User-Agent**: 네이버 지도의 강력한 봇 탐지 및 IP 차단을 우회하기 위해 `fake_useragent` 프로토콜과 Proxy 설정을 스크립트화 하였습니다.
- **Firebase 연동**: 크롤링한 결과를 현재 구축된 Firebase/Firestore의 `restaurants` 컬렉션에 곧바로 저장하도록 설계되었습니다.

## 실행 방법

현재 이 스튜디오 환경은 **Node.js 기반의 클라우드 컨테이너**입니다. 파이썬 크롤러는 IP 차단을 방지하기 위해 로컬 PC, 온프레미스 서버 또는 별도의 클라우드 환경(예: Google Cloud Run, AWS Lambda + Playwright layer 등)에서 실행해야 합니다.

1. **Python 환경 설정**
   이 디렉토리에서 아래 명령어로 의존성을 설치하세요.
   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```

2. **서비스 계정 키 추가**
   Firebase Admin SDK로 데이터를 밀어넣으려면 현재 접속 중인 Firebase 프로젝트의 `serviceAccountKey.json` 파일이 필요합니다.
   (Firebase Console -> 프로젝트 설정 -> 서비스 계정 -> 새 비공개 키 생성 후 `crawler/` 디렉토리에 저장)

3. **스크크립트 내 주석 해제 및 설정**
   - `naver_crawler.py` 내의 `PROXY_LIST`에 유효한 프록시 할당
   - Firebase 연동 로직 주석 해제

4. **실행**
   ```bash
   python naver_crawler.py
   ```

## 주의 사항
- 네이버의 DOM 구조(클래스명 등)는 수시로 변경(난독화)됩니다. 정기적으로 `document.querySelectorAll('.zPfVt')`와 같은 선택자를 브라우저 개발자 도구로 점검하여 갱신해야 합니다.
- 스크롤 이벤트 및 네트워크 지연 대기 (`page.evaluate('window.scrollTo...')`, `wait_until="networkidle"`)가 필수적입니다.
