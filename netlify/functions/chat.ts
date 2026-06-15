/**
 * Netlify Functions — POST /api/chat
 * Claude AI 맛집 추천 (서버리스 버전)
 * server.ts 없이 Netlify만으로 배포할 때 사용
 */
import type { Handler } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function initFirebase() {
  if (getApps().length > 0) return getFirestore();
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) return null;
  initializeApp({ credential: cert(JSON.parse(sa)) });
  return getFirestore();
}

// Mock fallback
const MOCK_RESTAURANTS = [
  { name:"강철돼지", dong:"상인동", trendScore:82, rating:4.8, keywords:["목살","단백질"], category:"고기" },
  { name:"쿠시 감삼", dong:"감삼동", trendScore:91, rating:4.7, keywords:["텐동","핫플"], category:"일식", isNew:true },
  { name:"아눅 델리", dong:"대곡동", trendScore:78, rating:4.6, keywords:["브런치","감성"], category:"카페" },
  { name:"소문난 손칼국수", dong:"죽전동", trendScore:73, rating:4.8, keywords:["손칼국수","줄서는"], category:"면/국수" },
  { name:"송정칼국수 본점", dong:"진천동", trendScore:65, rating:4.6, keywords:["국물맛","주차편리"], category:"면/국수" },
];

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" } };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { message, timeOfDay } = JSON.parse(event.body ?? "{}");
    if (!message?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "message 필요" }) };
    }

    // Firestore에서 상위 15개 식당 로드
    let restaurants = MOCK_RESTAURANTS;
    try {
      const db = initFirebase();
      if (db) {
        const snap = await db.collection("restaurants").orderBy("trendScore", "desc").limit(15).get();
        if (!snap.empty) restaurants = snap.docs.map(d => d.data() as any);
      }
    } catch { /* fallback to mock */ }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: `너는 대구시 달서구 맛집 추천 AI야.
반드시 아래 실제 데이터를 기반으로만 추천해. 데이터에 없는 식당은 추천하지 마.
트렌드 스코어, 별점, 키워드를 근거로 추천 이유를 구체적으로 설명해.
한국어로, 친근하고 간결하게. 식당 3곳 이내.`,
      messages: [{
        role: "user",
        content: `[시간대] ${timeOfDay ?? "일반"}\n[요청] ${message}\n\n[달서구 맛집 실데이터]\n${JSON.stringify(restaurants, null, 2)}`,
      }],
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true, reply }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};
