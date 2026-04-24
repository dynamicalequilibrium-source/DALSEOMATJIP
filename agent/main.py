import os
import sys
import traceback
import google.generativeai as genai

def run_agent():
    # 1. 환경 설정 (GitHub Secrets에서 주입)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("==============================================")
        print("[오류] GEMINI_API_KEY 환경 변수를 찾을 수 없습니다.")
        print("GitHub Repository > Settings > Secrets and variables > Actions 에 GEMINI_API_KEY를 등록했는지 확인해주세요.")
        print("==============================================")
        sys.exit(1)
        
    genai.configure(api_key=api_key)
    
    # 2. 모델 설정 (안정성이 검증된 gemini-1.5-pro로 변경)
    model = genai.GenerativeModel('gemini-1.5-pro')

    # 3. 데이터 수집 단계 (Mock Data)
    raw_data = """
    1. 달서구 상인동 '강철돼지': 고기가 아주 두툼하고 육즙이 넘칩니다. 지방이 적은 목살이 예술입니다. 가게 앞 주차장은 3대만 가능해서 조금 좁아요. 사장님이 운동하는 분인지 친절하게 식단 팁도 줍니다.
    2. 달서구 진천동 '영양가득 칼국수': 비 오는 날 먹기 좋음. 닭가슴살 고명이 산처럼 쌓여 나옴. 매장 뒤 공영주차장 지원되어 주차 아주 편함. 영수증 리뷰 보면 찐 단골이 많은 듯.
    """

    # 4. Gemini 분석 프롬프트 구성 (사용자 맞춤형 컨텍스트)
    prompt = f"""
    너는 대구시 달서구 맛집을 분석하는 최고 수준의 AI 에이전트야.
    아래 수집된 맛집뷰 데이터를 분석해서, 매일 운동을 즐기는 '181cm 러너'의 라이프스타일에 맞게 아침 데일리 브리핑을 작성해줘.

    [분석 및 필터링 기준]
    1. 신뢰도: 광고 느낌을 배제하고 실질적인 피드백(영수증 리뷰 뉘앙스) 중심 평가
    2. 영양가 (러너 핏): 단백질 함량, 탄수화물 구성, 고기의 질 등 식단에 얼마나 유리한지
    3. 접근성: 주차 편의성 여부 (운동 후 빠르게 방문하기 좋은지)
    4. 친절도 및 키워드 요약

    [수집된 리뷰 데이터]
    {raw_data}
    
    [출력 형태]
    오늘의 데일리 요약 대시보드 (마크다운 포맷)로 정리해서 보여줘.
    """
    
    print("[Agent] Analyzing data with Gemini...")
    try:
        response = model.generate_content(prompt)
        print("\n==============================================")
        print("🏃‍♂️ DALSEO GOURMET DAILY BRIEFING (09:00 AM) 🏃‍♂️")
        print("==============================================\n")
        print(response.text)
        
    except Exception as e:
        print("\n[오류] Gemini API 호출 중 문제가 발생했습니다:")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    run_agent()
