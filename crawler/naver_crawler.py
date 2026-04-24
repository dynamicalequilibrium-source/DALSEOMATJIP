import asyncio
import json
import random
import re
from playwright.async_api import async_playwright
from fake_useragent import UserAgent
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timezone

# --- Firebase 연동 설정 ---
# 서비스 계정 키(serviceAccountKey.json) 발급 후 경로를 지정하세요.
# cred = credentials.Certificate('serviceAccountKey.json')
# firebase_admin.initialize_app(cred)
# db = firestore.client()

# --- Proxy 목록 ---
# IP 차단 방지를 위해 사용할 프록시 서버 목록 (형식: "http://사용자:비밀번호@IP:포트")
PROXY_LIST = [
    # "http://user:pass@proxy1:port",
    # "http://user:pass@proxy2:port"
]

def extract_place_id(url):
    """
    네이버 지도 URL에서 업체 ID를 추출합니다.
    """
    match = re.search(r'/restaurant/(\d+)', url)
    if match:
        return match.group(1)
    
    match = re.search(r'/place/(\d+)', url)
    if match:
        return match.group(1)
        
    return None

async def crawl_naver_reviews(place_id):
    """
    Playwright를 사용하여 특정 장소의 방문자 리뷰 탭을 크롤링합니다.
    """
    ua = UserAgent()
    user_agent = ua.random
    
    proxy_server = random.choice(PROXY_LIST) if PROXY_LIST else None
    proxy_config = {"server": proxy_server} if proxy_server else None

    print(f"[Info] 크롤링 시작 - Place ID: {place_id}")
    print(f"[Info] User-Agent: {user_agent}")
    if proxy_server:
        print(f"[Info] Proxy: {proxy_server}")

    async with async_playwright() as p:
        # headless=True 로 백그라운드 실행
        browser = await p.chromium.launch(headless=True, proxy=proxy_config)
        
        # User-Agent 순환 적용
        context = await browser.new_context(user_agent=user_agent)
        page = await context.new_page()
        
        url = f"https://m.place.naver.com/restaurant/{place_id}/review/visitor"
        
        try:
            # 네트워크가 안정될 때까지 대기
            await page.goto(url, wait_until="networkidle", timeout=15000)
            
            # 스크롤을 내려 추가 리뷰를 로드할 수 있습니다.
            # await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            # await page.wait_for_timeout(2000)
            
            # 리뷰 데이터 파싱 (네이버 지도의 DOM 변경 시 수정 필요)
            reviews_data = await page.evaluate('''() => {
                // 참고: 클래스명('zPfVt' 등)은 주기적으로 변경될 수 있으므로, 실제 요소 확인 후 업데이트 필요
                const reviewElements = document.querySelectorAll('.zPfVt'); 
                const data = [];
                
                reviewElements.forEach(item => {
                    const textContent = item.innerText || '';
                    if (textContent.trim() !== '') {
                        data.push({
                            text: textContent,
                            collectedAt: new Date().toISOString()
                        });
                    }
                });
                return data;
            }''')
            
            print(f"[Success] {len(reviews_data)} 개의 리뷰를 추출했습니다.")
            
            # 추출된 데이터를 JSON으로 변환하여 확인
            result = json.dumps(reviews_data, ensure_ascii=False, indent=2)
            print(result)
            
            # Firestore에 저장하는 로직 예시
            # if reviews_data:
            #     doc_ref = db.collection('restaurants').document(place_id)
            #     doc_ref.set({
            #         'reviews': firestore.ArrayUnion(reviews_data),
            #         'updatedAt': firestore.SERVER_TIMESTAMP
            #     }, merge=True)
            #     print("[Info] Firestore 업로드 완료")
            
            return reviews_data
            
        except Exception as e:
            print(f"[Error] 크롤링 중 오류 발생: {e}")
            return None
        finally:
            await browser.close()

if __name__ == "__main__":
    # 테스트용 네이버 지도 URL 예시
    test_url = "https://m.place.naver.com/restaurant/13076121/home"
    extracted_id = extract_place_id(test_url)
    
    if extracted_id:
        asyncio.run(crawl_naver_reviews(extracted_id))
    else:
        print("[Error] URL에서 업체 ID를 추출하지 못했습니다.")
