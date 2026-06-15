"""
달서맛집 AI 분석 에이전트 v2
Gemini → Claude API 전환
분석 모듈: 신규감지 / 핫플스코어링 / 리뷰진정성 / 컨텍스트매칭 / 데일리브리핑
실행: python main.py  (GitHub Actions 스케줄 또는 수동)
"""
import os
import sys
import json
import re
from datetime import datetime, timezone, timedelta
from typing import Optional
import anthropic
import firebase_admin
from firebase_admin import credentials, firestore

# ── 초기화 ────────────────────────────────────────────────────────────────────
def init():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[오류] ANTHROPIC_API_KEY 환경변수가 없습니다.")
        print("GitHub Repository > Settings > Secrets > ANTHROPIC_API_KEY 를 등록하세요.")
        sys.exit(1)

    cred_path = os.environ.get("FIREBASE_CRED_PATH", "serviceAccountKey.json")
    db = None
    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("[OK] Firebase 연결 성공")
    except Exception as e:
        print(f"[WARN] Firebase 연결 실패 (dry-run 모드): {e}")

    client = anthropic.Anthropic(api_key=api_key)
    return client, db

def now_kst() -> datetime:
    return datetime.now(timezone(timedelta(hours=9)))

# ── Firestore 읽기 ────────────────────────────────────────────────────────────
def fetch_restaurants(db, limit: int = 30) -> list[dict]:
    """최신 업데이트 순으로 식당 데이터 로드."""
    if not db:
        return MOCK_RESTAURANTS

    docs = (
        db.collection("restaurants")
        .order_by("updatedAt", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    results = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        results.append(d)
    return results or MOCK_RESTAURANTS

def fetch_trends(db, limit: int = 20) -> list[dict]:
    """트렌드 스코어 상위 식당 로드."""
    if not db:
        return []
    docs = (
        db.collection("trends")
        .order_by("score", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]

# ── 목업 데이터 (Firebase 미연결 시 fallback) ─────────────────────────────────
MOCK_RESTAURANTS = [
    {
        "id": "12345678", "name": "송정칼국수 본점", "dong": "진천동",
        "rating": 4.6, "reviewCount": 1204, "saveCount": 342,
        "trendScore": 65, "trendDirection": "up",
        "keywords": ["주차편리", "국물맛", "양많음"],
        "blogMentions": {"days7": 12, "days30": 45, "days90": 110},
        "authenticityFlag": True, "isNew": False,
    },
    {
        "id": "23456789", "name": "강철돼지", "dong": "상인동",
        "rating": 4.8, "reviewCount": 876, "saveCount": 520,
        "trendScore": 82, "trendDirection": "up",
        "keywords": ["목살", "단백질", "운동후"],
        "blogMentions": {"days7": 31, "days30": 89, "days90": 180},
        "authenticityFlag": True, "isNew": False,
    },
    {
        "id": "56789012", "name": "쿠시 감삼", "dong": "감삼동",
        "rating": 4.7, "reviewCount": 342, "saveCount": 890,
        "trendScore": 91, "trendDirection": "up",
        "keywords": ["텐동", "20대", "핫플", "인스타"],
        "blogMentions": {"days7": 48, "days30": 95, "days90": 120},
        "authenticityFlag": True, "isNew": True,
    },
    {
        "id": "34567890", "name": "영양가득 칼국수", "dong": "진천동",
        "rating": 4.5, "reviewCount": 210, "saveCount": 115,
        "trendScore": 44, "trendDirection": "stable",
        "keywords": ["닭가슴살", "건강식", "주차가능"],
        "blogMentions": {"days7": 5, "days30": 18, "days90": 55},
        "authenticityFlag": True, "isNew": False,
    },
    {
        "id": "45678901", "name": "아눅 델리", "dong": "대곡동",
        "rating": 4.6, "reviewCount": 445, "saveCount": 2500,
        "trendScore": 78, "trendDirection": "up",
        "keywords": ["브런치", "커피", "감성", "여성"],
        "blogMentions": {"days7": 22, "days30": 67, "days90": 140},
        "authenticityFlag": True, "isNew": False,
    },
    {
        "id": "67890123", "name": "죽전 면옥", "dong": "죽전동",
        "rating": 4.4, "reviewCount": 189, "saveCount": 88,
        "trendScore": 28, "trendDirection": "stable",
        "keywords": ["냉면", "여름", "줄서는"],
        "blogMentions": {"days7": 3, "days30": 12, "days90": 40},
        "authenticityFlag": True, "isNew": False,
    },
    {
        "id": "78901234", "name": "본리 가든", "dong": "본리동",
        "rating": 4.2, "reviewCount": 520, "saveCount": 210,
        "trendScore": 35, "trendDirection": "stable",
        "keywords": ["회식", "주차50대", "단체석"],
        "blogMentions": {"days7": 7, "days30": 28, "days90": 95},
        "authenticityFlag": True, "isNew": False,
    },
    {
        "id": "90123456", "name": "월성 삼계탕", "dong": "월성동",
        "rating": 4.3, "reviewCount": 267, "saveCount": 145,
        "trendScore": 38, "trendDirection": "stable",
        "keywords": ["보양식", "여름", "원기회복"],
        "blogMentions": {"days7": 6, "days30": 22, "days90": 70},
        "authenticityFlag": True, "isNew": False,
    },
]

# ── 분석 모듈 1: 신규 식당 감지 리포트 ──────────────────────────────────────
def analyze_new_restaurants(client: anthropic.Anthropic, restaurants: list[dict]) -> str:
    new_items = [r for r in restaurants if r.get("isNew")]
    if not new_items:
        return "이번 주 신규 등록 식당이 없습니다."

    data_str = json.dumps(new_items, ensure_ascii=False, indent=2)
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=800,
        system=(
            "너는 대구시 달서구 맛집 데이터 분석 전문가야. "
            "신규 식당 데이터를 분석해서 간결하고 유익한 리포트를 작성해. "
            "반드시 한국어로, 마크다운 형식으로 답변해."
        ),
        messages=[{
            "role": "user",
            "content": f"""아래 달서구 신규 등록 식당 데이터를 분석해줘.

[신규 식당 데이터]
{data_str}

다음 형식으로 작성해줘:
## 🆕 이번 달 신규 오픈 맛집

식당별로:
- **식당명** (위치): 주목 이유, 초기 반응 지표, 방문 추천 포인트
"""
        }],
    )
    return msg.content[0].text

# ── 분석 모듈 2: 핫플 TOP5 스코어링 ─────────────────────────────────────────
def analyze_hotplaces(client: anthropic.Anthropic, restaurants: list[dict]) -> str:
    sorted_r = sorted(restaurants, key=lambda x: x.get("trendScore", 0), reverse=True)[:5]
    data_str = json.dumps(sorted_r, ensure_ascii=False, indent=2)

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=900,
        system=(
            "너는 달서구 맛집 트렌드 분석가야. "
            "데이터 기반으로 지금 가장 핫한 식당을 분석하고 "
            "왜 핫한지 이유를 구체적으로 설명해. 한국어 마크다운으로."
        ),
        messages=[{
            "role": "user",
            "content": f"""트렌드 스코어 상위 식당들을 분석해줘.

[트렌드 데이터]
{data_str}

형식:
## 🔥 지금 달서구에서 가장 핫한 맛집 TOP5

순위별로:
**N위. 식당명** — 트렌드 스코어: XX점
- 핫한 이유: (블로그 언급량, 저장수, 리뷰 증가율 데이터 기반)
- 타겟 고객: 
- 추천 상황:
"""
        }],
    )
    return msg.content[0].text

# ── 분석 모듈 3: 리뷰 진정성 필터링 ─────────────────────────────────────────
def analyze_review_authenticity(client: anthropic.Anthropic, restaurants: list[dict]) -> str:
    data_str = json.dumps([{
        "name": r["name"],
        "reviewCount": r.get("reviewCount", 0),
        "saveCount": r.get("saveCount", 0),
        "keywords": r.get("keywords", []),
        "authenticityFlag": r.get("authenticityFlag", True),
        "blogMentions": r.get("blogMentions", {}),
    } for r in restaurants], ensure_ascii=False, indent=2)

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=700,
        system=(
            "너는 맛집 리뷰 진정성 분석 전문가야. "
            "광고/협찬 리뷰 패턴을 찾아내고, 신뢰할 수 있는 식당을 선별해줘. "
            "한국어 마크다운으로."
        ),
        messages=[{
            "role": "user",
            "content": f"""아래 식당들의 리뷰 진정성을 분석해줘.

[리뷰 데이터]
{data_str}

판단 기준:
- 저장수 대비 리뷰 비율 (저장>>리뷰 = 광고 의심)
- 키워드 다양성 (획일적 키워드 = 체험단 의심)
- 블로그 7일/90일 비율 (급격한 급증 = 마케팅 의심)

형식:
## ✅ 리뷰 진정성 분석 결과

**신뢰도 높은 식당 (영수증 리뷰 기반):**
...

**주의 필요 식당:**
...
"""
        }],
    )
    return msg.content[0].text

# ── 분석 모듈 4: 컨텍스트 매칭 (실시간 API용) ────────────────────────────────
def analyze_context_match(
    client: anthropic.Anthropic,
    restaurants: list[dict],
    user_query: str,
    weather: Optional[str] = None,
    time_of_day: Optional[str] = None,
) -> str:
    context_parts = []
    if weather:
        context_parts.append(f"현재 날씨: {weather}")
    if time_of_day:
        context_parts.append(f"현재 시간대: {time_of_day}")
    context_str = " / ".join(context_parts) if context_parts else "일반 상황"

    top_restaurants = sorted(
        restaurants, key=lambda x: x.get("trendScore", 0), reverse=True
    )[:15]
    data_str = json.dumps(top_restaurants, ensure_ascii=False, indent=2)

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        system=(
            "너는 달서구 맛집 추천 AI야. "
            "실제 데이터를 기반으로 사용자 상황에 딱 맞는 맛집을 3곳 추천해줘. "
            "추천 이유는 데이터 근거(별점, 트렌드, 키워드)를 포함해서 구체적으로. "
            "한국어로, 친근하게."
        ),
        messages=[{
            "role": "user",
            "content": f"""상황: {context_str}
사용자 요청: {user_query}

[달서구 맛집 데이터]
{data_str}

위 데이터를 바탕으로 요청에 가장 잘 맞는 맛집 3곳을 추천해줘.
각 추천에 식당명, 위치, 추천 이유(데이터 근거 포함), 특징을 포함해줘."""
        }],
    )
    return msg.content[0].text

# ── 통합 데일리 브리핑 ────────────────────────────────────────────────────────
def generate_daily_briefing(client: anthropic.Anthropic, restaurants: list[dict]) -> str:
    today = now_kst().strftime("%Y년 %m월 %d일 %A")

    top5 = sorted(restaurants, key=lambda x: x.get("trendScore", 0), reverse=True)[:5]
    new_ones = [r for r in restaurants if r.get("isNew")]
    total_reviews = sum(r.get("reviewCount", 0) for r in restaurants)
    avg_score = sum(r.get("trendScore", 0) for r in restaurants) / len(restaurants)

    summary = {
        "date": today,
        "total_restaurants": len(restaurants),
        "total_reviews": total_reviews,
        "avg_trend_score": round(avg_score, 1),
        "new_count": len(new_ones),
        "top5": [{
            "name": r["name"], "dong": r.get("dong", ""),
            "score": r.get("trendScore"), "rating": r.get("rating"),
            "keywords": r.get("keywords", [])[:3],
        } for r in top5],
        "new_restaurants": [{"name": r["name"], "dong": r.get("dong", "")} for r in new_ones],
    }

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1200,
        system=(
            "너는 달서구 맛집 데일리 브리핑을 작성하는 AI야. "
            "데이터 기반으로 오늘 달서구 맛집 현황을 요약해줘. "
            "읽기 편한 마크다운 형식, 한국어로."
        ),
        messages=[{
            "role": "user",
            "content": f"""오늘의 달서구 맛집 데이터를 바탕으로 데일리 브리핑을 작성해줘.

[오늘의 통계]
{json.dumps(summary, ensure_ascii=False, indent=2)}

형식:
# 🍽️ 달서구 맛집 데일리 브리핑 — {today}

## 📊 오늘의 요약
(전체 현황 3줄 요약)

## 🔥 오늘의 핫플 TOP3
(상위 3곳, 각각 이유 1줄)

## 🆕 신규 오픈
(새 식당 소개)

## 💡 오늘의 추천 포인트
(날씨/계절/트렌드 기반 한마디)
"""
        }],
    )
    return msg.content[0].text

# ── Firestore 브리핑 저장 ──────────────────────────────────────────────────
def save_briefing(db, briefing: str, analysis: dict):
    if not db:
        return
    today_key = now_kst().strftime("%Y-%m-%d")
    db.collection("briefings").document(today_key).set({
        "date":        today_key,
        "briefing":    briefing,
        "newReport":   analysis.get("new", ""),
        "hotReport":   analysis.get("hot", ""),
        "authReport":  analysis.get("auth", ""),
        "createdAt":   firestore.SERVER_TIMESTAMP,
    })
    print(f"[OK] 브리핑 저장 완료: briefings/{today_key}")

# ── 메인 ──────────────────────────────────────────────────────────────────────
def run():
    print("=" * 50)
    print("🍽️  달서맛집 AI 에이전트 시작")
    print("=" * 50)

    client, db = init()
    restaurants = fetch_restaurants(db)
    print(f"[OK] 식당 데이터 {len(restaurants)}개 로드")

    # 분석 실행
    print("\n[1/4] 신규 식당 분석...")
    new_report  = analyze_new_restaurants(client, restaurants)

    print("[2/4] 핫플 TOP5 분석...")
    hot_report  = analyze_hotplaces(client, restaurants)

    print("[3/4] 리뷰 진정성 분석...")
    auth_report = analyze_review_authenticity(client, restaurants)

    print("[4/4] 데일리 브리핑 생성...")
    briefing    = generate_daily_briefing(client, restaurants)

    # 결과 출력
    print("\n" + "=" * 50)
    print(briefing)
    print("\n" + "=" * 50)
    print(hot_report)
    print("\n" + "=" * 50)
    print(new_report)
    print("\n" + "=" * 50)
    print(auth_report)

    # 저장
    save_briefing(db, briefing, {"new": new_report, "hot": hot_report, "auth": auth_report})

    # 트렌드 업데이트
    if db:
        for r in restaurants:
            if r.get("trendScore", 0) > 70:
                db.collection("trends").document(r["id"]).set({
                    "restaurantId":  r["id"],
                    "name":          r["name"],
                    "dong":          r.get("dong", ""),
                    "score":         r.get("trendScore", 0),
                    "trendDirection": r.get("trendDirection", "stable"),
                    "reason": " • ".join([
                        f"블로그 {r.get('blogMentions', {}).get('days7', 0)}건(7일)",
                        f"저장수 {r.get('saveCount', 0)}",
                        f"별점 {r.get('rating', 0)}",
                    ]),
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }, merge=True)
        print("[OK] 트렌드 데이터 업데이트 완료")

    print("\n✅ 에이전트 실행 완료")


# ── 컨텍스트 추천 API 진입점 (Express에서 호출) ────────────────────────────
def recommend(query: str, weather: str = "", time_of_day: str = "") -> str:
    """API 서버에서 직접 호출하는 추천 함수."""
    client, db = init()
    restaurants = fetch_restaurants(db)
    return analyze_context_match(client, restaurants, query, weather, time_of_day)


if __name__ == "__main__":
    run()
