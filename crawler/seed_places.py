"""
달서구 맛집 네이버 플레이스 ID 자동 수집 스크립트
실행: python seed_places.py
결과: place_ids.json (PLACE_TARGETS 배열에 바로 복붙 가능)
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

SEARCH_QUERIES = [
    "달서구 상인동 맛집",
    "달서구 감삼동 맛집",
    "달서구 진천동 맛집",
    "달서구 죽전동 맛집",
    "달서구 대곡동 맛집",
    "달서구 월성동 맛집",
    "달서구 본리동 맛집",
    "달서구 이곡동 맛집",
]

DONG_MAP = {
    "상인": "상인동", "감삼": "감삼동", "진천": "진천동",
    "죽전": "죽전동", "대곡": "대곡동", "월성": "월성동",
    "본리": "본리동", "이곡": "이곡동", "유천": "유천동",
}

async def collect_place_ids():
    results = []
    seen = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            viewport={"width": 390, "height": 844},
            locale="ko-KR",
        )
        page = await ctx.new_page()

        for q in SEARCH_QUERIES:
            print(f"\n🔍 검색: {q}")
            dong_key = next((k for k in DONG_MAP if k in q), "달서구")
            dong = DONG_MAP.get(dong_key, "달서구")

            url = f"https://m.map.naver.com/search2/search.naver?query={q}&sm=clk&style=v5"
            try:
                await page.goto(url, wait_until="networkidle", timeout=20000)
                await page.wait_for_timeout(2000)

                # 네트워크 요청에서 placeId 추출
                items = await page.evaluate('''() => {
                    const results = [];
                    // 검색 결과 리스트 아이템
                    const els = document.querySelectorAll("li[data-id], li[class*='place']");
                    els.forEach(el => {
                        const id = el.getAttribute("data-id") ||
                                   el.getAttribute("data-place-id");
                        const nameEl = el.querySelector("strong, .place_name, ._3GHn2");
                        const name = nameEl ? nameEl.innerText.trim() : "";
                        if (id && name && /^\\d+$/.test(id)) {
                            results.push({ id, name });
                        }
                    });

                    // href에서 ID 추출 (fallback)
                    const links = document.querySelectorAll("a[href*='/restaurant/'], a[href*='place.naver.com']");
                    links.forEach(a => {
                        const m = a.href.match(/restaurant\\/(\\d+)/);
                        if (m) {
                            const name = a.querySelector("strong")?.innerText?.trim() || "";
                            if (name) results.push({ id: m[1], name });
                        }
                    });

                    return results;
                }''')

                for item in items:
                    pid = item.get("id", "")
                    name = item.get("name", "").strip()
                    if pid and name and pid not in seen:
                        seen.add(pid)
                        results.append({
                            "placeId": pid,
                            "name": name,
                            "dong": dong,
                        })
                        print(f"  ✓ {name} ({pid}) — {dong}")

                await page.wait_for_timeout(1500)

            except Exception as e:
                print(f"  ✗ 오류: {e}")

        await browser.close()

    # 결과 저장
    with open("place_ids.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 총 {len(results)}개 수집 → place_ids.json")
    print("\n=== naver_crawler.py PLACE_TARGETS 에 붙여넣기 ===")
    print("PLACE_TARGETS = " + json.dumps(results, ensure_ascii=False, indent=4))
    return results

if __name__ == "__main__":
    asyncio.run(collect_place_ids())
