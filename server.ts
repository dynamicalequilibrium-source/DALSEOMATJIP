/**
 * 달서맛집 Express API 서버 (Netlify Functions 또는 독립 실행)
 * 엔드포인트:
 *   GET  /api/restaurants     — 전체 식당 목록 (필터: dong, sort, limit)
 *   GET  /api/trends          — 트렌드 TOP N
 *   GET  /api/new             — 신규 오픈 식당
 *   GET  /api/briefing        — 오늘의 AI 브리핑
 *   POST /api/chat            — Claude 실시간 맛집 추천 채팅
 */
import express, { Request, Response } from "express";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Query } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";

const app = express();
app.use(express.json());

// CORS (개발 환경)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Firebase 초기화 ──────────────────────────────────────────────────────────
const credPath = process.env.FIREBASE_CRED_PATH ?? "serviceAccountKey.json";
let db: ReturnType<typeof getFirestore> | null = null;
try {
  const serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf-8"));
  initializeApp({ credential: cert(serviceAccount) });
  db = getFirestore();
  console.log("[OK] Firebase 연결 성공");
} catch (e) {
  console.warn("[WARN] Firebase 연결 실패 — Mock 데이터 사용");
}

// ── Anthropic 클라이언트 ──────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
async function getRestaurants(
  dong?: string,
  sort: string = "trendScore",
  limit: number = 30
) {
  if (!db) return [];
  let q: Query = db.collection("restaurants");
  if (dong) q = q.where("dong", "==", dong);
  const snap = await q.orderBy(sort, "desc").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── GET /api/restaurants ─────────────────────────────────────────────────────
app.get("/api/restaurants", async (req: Request, res: Response) => {
  try {
    const { dong, sort = "trendScore", limit = "30" } = req.query as Record<string, string>;
    const data = await getRestaurants(dong, sort, Number(limit));
    res.json({ ok: true, count: data.length, data });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/trends ──────────────────────────────────────────────────────────
app.get("/api/trends", async (req: Request, res: Response) => {
  try {
    if (!db) return res.json({ ok: true, data: [] });
    const limit = Number(req.query.limit ?? 10);
    const snap = await db.collection("trends").orderBy("score", "desc").limit(limit).get();
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, data });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/new ─────────────────────────────────────────────────────────────
app.get("/api/new", async (req: Request, res: Response) => {
  try {
    if (!db) return res.json({ ok: true, data: [] });
    const snap = await db.collection("restaurants")
      .where("isNew", "==", true)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, data });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/briefing ────────────────────────────────────────────────────────
app.get("/api/briefing", async (req: Request, res: Response) => {
  try {
    if (!db) return res.json({ ok: true, data: null });
    const today = new Date().toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    }).replace(/\. /g, "-").replace(".", "");
    const doc = await db.collection("briefings").doc(today).get();
    res.json({ ok: true, data: doc.exists ? { id: doc.id, ...doc.data() } : null });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/chat ────────────────────────────────────────────────────────────
app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    const { message, weather, timeOfDay } = req.body as {
      message: string;
      weather?: string;
      timeOfDay?: string;
    };

    if (!message?.trim()) {
      return res.status(400).json({ ok: false, error: "message 필드가 필요합니다." });
    }

    // Firestore에서 상위 트렌드 식당 로드
    const restaurants = await getRestaurants(undefined, "trendScore", 20);

    const contextParts: string[] = [];
    if (weather) contextParts.push(`날씨: ${weather}`);
    if (timeOfDay) contextParts.push(`시간대: ${timeOfDay}`);
    const contextStr = contextParts.join(" / ") || "일반 상황";

    const dataStr = JSON.stringify(restaurants.slice(0, 15), null, 2);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: `너는 대구시 달서구 맛집 추천 AI야.
반드시 아래 실제 데이터를 기반으로만 추천해. 데이터에 없는 식당은 추천하지 마.
트렌드 스코어, 별점, 키워드를 근거로 추천 이유를 구체적으로 설명해.
한국어로, 친근하고 간결하게. 식당 3곳 이내로.`,
      messages: [
        {
          role: "user",
          content: `[현재 상황] ${contextStr}
[사용자 요청] ${message}

[달서구 맛집 실데이터]
${dataStr}`,
        },
      ],
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "";
    res.json({ ok: true, reply });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 서버 시작 ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`[달서맛집 API] http://localhost:${PORT}`);
});

export default app;
