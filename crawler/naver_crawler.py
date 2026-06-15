"""
달서맛집 네이버 크롤러 v2
수집: 네이버 플레이스(별점·리뷰수·저장수·태그) + 블로그 언급량 + 신규 식당 감지
저장: Firebase Firestore
실행: python naver_crawler.py --target all|place|blog|new
"""
import asyncio
import json
import random
import re
import sys
import argparse
from datetime import datetime, timezone, timedelta
from typing import Optional

from playwright.async_api import async_playwright, Page
from fake_useragent import UserAgent
import firebase_admin
from firebase_admin import credentials, firestore

# ── Firebase 초기화 ──────────────────────────────────────────────────────────
def init_firebase(cred_path: str = "serviceAccountKey.json"):
    """Firebase Admin SDK 초기화. serviceAccountKey.json 경로 필요."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    return firestore.client()

# ── 상수 ─────────────────────────────────────────────────────────────────────
# 달서구 주요 행정동 — 필터링 및 태깅에 사용
DALSEО_DONGS = [
    "상인동", "진천동", "월성동", "죽전동", "감삼동",
    "본리동", "대곡동", "본동", "이곡동", "신당동",
    "용산동", "갈산동", "장기동", "유천동", "호산동",
]

PROXY_LIST: list[str] = [
    # "http://user:pass@proxy1:port",
]

USER_AGENT_POOL = UserAgent()

# 네이버 플레이스 크롤링 대상 (placeId → 식당명 매핑)
# 실제 운영 시 Firestore 또는 별도 JSON에서 로드
PLACE_TARGETS: list[dict] = [
    {"placeId": "12345678", "name": "송정칼국수 본점",   "dong": "진천동"},
    {"placeId": "23456789", "name": "강철돼지",          "dong": "상인동"},
    {"placeId": "34567890", "name": "영양가득 칼국수",   "dong": "진천동"},
    {"placeId": "45678901", "name": "아눅 델리",         "dong": "대곡동"},
    {"placeId": "56789012", "name": "쿠시 감삼",         "dong": "감삼동"},
    {"placeId": "67890123", "name": "죽전 면옥",         "dong": "죽전동"},
    {"placeId": "78901234", "name": "본리 가든",         "dong": "본리동"},
    {"placeId": "89012345", "name": "월성 삼계탕",       "dong": "월성동"},
    {"placeId": "90123456", "name": "월배 정나루",       "dong": "상인동"},
    {"placeId": "01234567", "name": "소문난 손칼국수",   "dong": "죽전동"},
]

# ── 유틸 ─────────────────────────────────────────────────────────────────────
def pick_proxy() -> Optional[dict]:
    if not PROXY_LIST:
        return None
    return {"server": random.choice(PROXY_LIST)}

def now_kst() -> datetime:
    return datetime.now(timezone(timedelta(hours=9)))

def log(msg: str):
    ts = now_kst().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")

# ── 네이버 플레이스 크롤러 ───────────────────────────────────────────────────
async def crawl_place(page: Page, place_id: str) -> dict:
    """
    네이버 플레이스 방문자 리뷰 탭에서 핵심 지표 추출.
    반환: rating, review_count, save_count, keywords, photo_count, blog_count
    """
    url = f"https://m.place.naver.com/restaurant/{place_id}/review/visitor"
    result = {
        "rating": None,
        "review_count": 0,
        "save_count": 0,
        "keywords": [],
        "photo_count": 0,
        "blog_count": 0,
        "crawled_at": now_kst().isoformat(),
    }

    try:
        await page.goto(url, wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(1500)

        data = await page.evaluate('''() => {
            const getText = (sel) => {
                const el = document.querySelector(sel);
                return el ? el.innerText.trim() : null;
            };
            const getAll = (sel) => {
                return Array.from(document.querySelectorAll(sel)).map(e => e.innerText.trim());
            };
            const getNum = (text) => {
                if (!text) return 0;
                const n = text.replace(/[^0-9]/g, "");
                return n ? parseInt(n) : 0;
            };

            // 별점 (.place_section_content 내 평점 영역)
            const ratingEl = document.querySelector(".PXMot");
            const ratingText = ratingEl ? ratingEl.innerText : null;
            const rating = ratingText ? parseFloat(ratingText) : null;

            // 방문자 리뷰 수
            const reviewCountEl = document.querySelector(".place_section_header .pui__vn15t2");
            const reviewCount = getNum(reviewCountEl ? reviewCountEl.innerText : "0");

            // 저장 수 (북마크)
            const saveEl = document.querySelector(".saved_count, .pcg8i");
            const saveCount = getNum(saveEl ? saveEl.innerText : "0");

            // 방문자 키워드 태그
            const keywords = getAll(".pui__HMos4H, .place_blind_txt").slice(0, 10);

            // 사진 수
            const photoCountEl = document.querySelector(".media_count");
            const photoCount = getNum(photoCountEl ? photoCountEl.innerText : "0");

            // 블로그 리뷰 수
            const blogEl = document.querySelector(".pui__bhRpg5");
            const blogCount = getNum(blogEl ? blogEl.innerText : "0");

            return { rating, reviewCount, saveCount, keywords, photoCount, blogCount };
        }''')

        result.update({
            "rating": data.get("rating"),
            "review_count": data.get("reviewCount", 0),
            "save_count": data.get("saveCount", 0),
            "keywords": [k for k in data.get("keywords", []) if k],
            "photo_count": data.get("photoCount", 0),
            "blog_count": data.get("blogCount", 0),
        })
        log(f"  ✓ 플레이스 {place_id}: 별점={result['rating']}, 리뷰={result['review_count']}, 저장={result['save_count']}")

    except Exception as e:
        log(f"  ✗ 플레이스 {place_id} 오류: {e}")

    return result

# ── 네이버 블로그 언급량 크롤러 ─────────────────────────────────────────────
async def crawl_blog_mentions(page: Page, restaurant_name: str, dong: str) -> dict:
    """
    네이버 블로그 검색에서 최근 7일 / 30일 / 90일 언급량 측정.
    트렌드 지수 산출에 사용.
    """
    query = f"달서구 {dong} {restaurant_name}"
    result = {"blog_7d": 0, "blog_30d": 0, "blog_90d": 0}

    def date_param(days_ago: int) -> str:
        d = now_kst() - timedelta(days=days_ago)
        return d.strftime("%Y.%m.%d")

    periods = [
        ("blog_7d",  7),
        ("blog_30d", 30),
        ("blog_90d", 90),
    ]

    for key, days in periods:
        try:
            start = date_param(days)
            end   = date_param(0)
            url = (
                f"https://search.naver.com/search.naver?where=blog"
                f"&query={query}"
                f"&nso=so:dd,p:from{start.replace('.','')}"
                f"to{end.replace('.','')}"
            )
            await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_timeout(800)

            count_text = await page.evaluate('''() => {
                const el = document.querySelector(".title_num") ||
                           document.querySelector(".result_num");
                return el ? el.innerText : "0";
            }''')
            count = int(re.sub(r"[^0-9]", "", count_text or "0") or 0)
            result[key] = count
            log(f"  ✓ 블로그 {restaurant_name} {days}일: {count}건")

        except Exception as e:
            log(f"  ✗ 블로그 {restaurant_name} {days}일 오류: {e}")

    return result

# ── 신규 식당 감지 ───────────────────────────────────────────────────────────
async def detect_new_restaurants(page: Page) -> list[dict]:
    """
    네이버 지도에서 달서구 최근 등록 식당 탐지.
    '최근 등록' 필터 + 리뷰 수 급증 패턴으로 신규 핫플 선별.
    """
    log("신규 식당 탐지 시작...")
    new_restaurants = []

    search_url = (
        "https://m.map.naver.com/search2/search.naver"
        "?query=달서구+맛집&sm=clk&style=v5&type=SITE_1"
    )

    try:
        await page.goto(search_url, wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        items = await page.evaluate('''() => {
            const results = [];
            const items = document.querySelectorAll(".search_list li, ._3GHn2");
            items.forEach(item => {
                const name = item.querySelector(".place_bluelink, ._3GHn2") ?.innerText?.trim();
                const address = item.querySelector(".lnfwd, ._2yQNo") ?.innerText?.trim();
                const rating = item.querySelector(".PXMot, ._2p3tN") ?.innerText?.trim();
                const category = item.querySelector(".KCMnt, .category") ?.innerText?.trim();
                if (name) results.push({ name, address, rating, category });
            });
            return results.slice(0, 20);
        }''')

        for item in items:
            addr = item.get("address", "")
            if any(dong in addr for dong in DALSEО_DONGS):
                dong = next((d for d in DALSEО_DONGS if d in addr), "달서구")
                new_restaurants.append({
                    "name":        item.get("name", ""),
                    "dong":        dong,
                    "category":    item.get("category", ""),
                    "raw_rating":  item.get("rating", ""),
                    "detected_at": now_kst().isoformat(),
                    "is_new":      True,
                })

        log(f"  ✓ 신규 후보 {len(new_restaurants)}개 감지")

    except Exception as e:
        log(f"  ✗ 신규 식당 탐지 오류: {e}")

    return new_restaurants

# ── 트렌드 스코어 계산 ───────────────────────────────────────────────────────
def calc_trend_score(
    review_count: int,
    save_count: int,
    blog_7d: int,
    blog_30d: int,
    blog_90d: int,
    prev_review_count: int = 0,
) -> dict:
    """
    트렌드 지수 0~100 계산.
    가중치: 블로그 급증(40%) + 저장수(30%) + 리뷰 증가율(30%)
    """
    # 블로그 최근성 비율
    blog_recency = (blog_7d * 4 + blog_30d) / max(blog_90d + 1, 1) * 10
    blog_score = min(blog_recency * 4, 40)

    # 저장수 (최대 30점, 1000저장 = 30점)
    save_score = min(save_count / 1000 * 30, 30)

    # 리뷰 증가율 (최대 30점)
    if prev_review_count > 0:
        growth = (review_count - prev_review_count) / prev_review_count
        review_score = min(growth * 30, 30)
    else:
        review_score = min(review_count / 100 * 10, 30)

    total = blog_score + save_score + review_score

    if total >= 70:
        direction, label = "up",     "🔥 Trending"
    elif total >= 40:
        direction, label = "up",     "↑ Rising"
    elif total >= 20:
        direction, label = "stable", "→ Stable"
    else:
        direction, label = "down",   "↓ Cooling"

    return {
        "score":     round(total, 1),
        "direction": direction,
        "label":     label,
        "detail": {
            "blog_score":   round(blog_score, 1),
            "save_score":   round(save_score, 1),
            "review_score": round(review_score, 1),
        },
    }

# ── Firestore 저장 ───────────────────────────────────────────────────────────
def save_restaurant(db, target: dict, place_data: dict, blog_data: dict, trend: dict):
    """식당 정보 + 트렌드 지수를 Firestore에 upsert."""
    place_id = target["placeId"]
    doc_ref = db.collection("restaurants").document(place_id)
    existing = doc_ref.get()

    keywords_filtered = [k for k in place_data.get("keywords", []) if len(k) > 1]

    # 광고성 키워드 단순 필터 (Claude 분석 전 1차 필터)
    ad_keywords = {"협찬", "광고", "제공받아", "서포터즈", "체험단"}
    authenticity_flag = not any(kw in str(keywords_filtered) for kw in ad_keywords)

    payload = {
        "name":              target["name"],
        "dong":              target["dong"],
        "location":          f"달서구 {target['dong']}",
        "placeId":           place_id,
        "rating":            place_data.get("rating"),
        "reviewCount":       place_data.get("review_count", 0),
        "saveCount":         place_data.get("save_count", 0),
        "photoCount":        place_data.get("photo_count", 0),
        "blogCountNaver":    place_data.get("blog_count", 0),
        "keywords":          keywords_filtered[:8],
        "blogMentions": {
            "days7":  blog_data.get("blog_7d", 0),
            "days30": blog_data.get("blog_30d", 0),
            "days90": blog_data.get("blog_90d", 0),
        },
        "trendScore":        trend["score"],
        "trendDirection":    trend["direction"],
        "trendLabel":        trend["label"],
        "trendDetail":       trend["detail"],
        "authenticityFlag":  authenticity_flag,
        "updatedAt":         firestore.SERVER_TIMESTAMP,
    }

    if not existing.exists:
        payload["createdAt"] = firestore.SERVER_TIMESTAMP
        payload["isNew"] = True
        doc_ref.set(payload)
        log(f"  → Firestore 신규 저장: {target['name']}")
    else:
        doc_ref.update(payload)
        log(f"  → Firestore 업데이트: {target['name']}")

    # 트렌드 컬렉션에도 기록
    trend_ref = db.collection("trends").document(place_id)
    trend_ref.set({
        "restaurantId":  place_id,
        "name":          target["name"],
        "dong":          target["dong"],
        "score":         trend["score"],
        "trendDirection": trend["direction"],
        "reason": (
            f"블로그 {blog_data.get('blog_7d', 0)}건(7일) "
            f"• 저장수 {place_data.get('save_count', 0)} "
            f"• 리뷰 {place_data.get('review_count', 0)}"
        ),
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }, merge=True)

def save_new_restaurant(db, item: dict):
    """신규 감지 식당 저장."""
    name_slug = re.sub(r"[^a-zA-Z0-9가-힣]", "_", item["name"])[:40]
    doc_ref = db.collection("restaurants").document(f"new_{name_slug}")
    if not doc_ref.get().exists:
        doc_ref.set({
            **item,
            "isNew":     True,
            "isAiPick":  False,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        log(f"  → 신규 식당 저장: {item['name']}")

# ── 메인 실행 ────────────────────────────────────────────────────────────────
async def run(target: str = "all", cred_path: str = "serviceAccountKey.json"):
    log(f"=== 달서맛집 크롤러 시작 (target={target}) ===")

    db = None
    try:
        db = init_firebase(cred_path)
        log("Firebase 연결 성공")
    except Exception as e:
        log(f"Firebase 연결 실패 (dry-run 모드): {e}")

    proxy = pick_proxy()
    ua = USER_AGENT_POOL.random

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, proxy=proxy)
        ctx = await browser.new_context(
            user_agent=ua,
            viewport={"width": 390, "height": 844},
            locale="ko-KR",
        )
        page = await ctx.new_page()

        # ── 신규 식당 감지
        if target in ("all", "new"):
            new_items = await detect_new_restaurants(page)
            if db:
                for item in new_items:
                    save_new_restaurant(db, item)

        # ── 플레이스 + 블로그 크롤링
        if target in ("all", "place", "blog"):
            for t in PLACE_TARGETS:
                log(f"\n[{t['name']}] 크롤링 중...")
                await asyncio.sleep(random.uniform(1.5, 3.0))  # anti-bot delay

                place_data = {}
                blog_data  = {}

                if target in ("all", "place"):
                    place_data = await crawl_place(page, t["placeId"])

                if target in ("all", "blog"):
                    blog_data = await crawl_blog_mentions(page, t["name"], t["dong"])

                # 이전 리뷰 수 조회 (증가율 계산용)
                prev_review = 0
                if db:
                    prev_doc = db.collection("restaurants").document(t["placeId"]).get()
                    if prev_doc.exists:
                        prev_review = prev_doc.to_dict().get("reviewCount", 0)

                trend = calc_trend_score(
                    review_count=place_data.get("review_count", 0),
                    save_count=place_data.get("save_count", 0),
                    blog_7d=blog_data.get("blog_7d", 0),
                    blog_30d=blog_data.get("blog_30d", 0),
                    blog_90d=blog_data.get("blog_90d", 0),
                    prev_review_count=prev_review,
                )

                log(f"  트렌드 스코어: {trend['score']} ({trend['label']})")

                if db:
                    save_restaurant(db, t, place_data, blog_data, trend)
                else:
                    print(json.dumps({**place_data, **blog_data, "trend": trend}, ensure_ascii=False, indent=2))

        await browser.close()

    log("\n=== 크롤링 완료 ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="달서맛집 네이버 크롤러")
    parser.add_argument("--target", choices=["all", "place", "blog", "new"], default="all")
    parser.add_argument("--cred",   default="serviceAccountKey.json")
    args = parser.parse_args()
    asyncio.run(run(target=args.target, cred_path=args.cred))
