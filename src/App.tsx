/**
 * 달서맛집 앱 v2
 * 탭: 대시보드 / 신규맛집 / 랭킹 / AI채팅
 * AI: Claude API (Anthropic) — 실데이터 기반 맛집 추천
 * DB: Firestore (restaurants / trends / briefings)
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import {
  collection, query, getDocs, orderBy, limit,
  where, doc, getDoc,
} from "firebase/firestore";

// ── 타입 ─────────────────────────────────────────────────────────────────────
interface Restaurant {
  id: string;
  name: string;
  dong: string;
  location?: string;
  rating?: number;
  reviewCount?: number;
  saveCount?: number;
  trendScore?: number;
  trendDirection?: "up" | "stable" | "down";
  trendLabel?: string;
  keywords?: string[];
  blogMentions?: { days7: number; days30: number; days90: number };
  isNew?: boolean;
  isAiPick?: boolean;
  authenticityFlag?: boolean;
  aiAnalysis?: string;
  category?: string;
  imageUrl?: string;
  naverUrl?: string;
}
interface TrendItem {
  id: string;
  restaurantId: string;
  name: string;
  dong: string;
  score: number;
  trendDirection: string;
  reason: string;
}
interface ChatMsg { role: "user" | "ai"; text: string }
type Tab = "dashboard" | "new" | "ranking" | "chat";

// ── 달서구 동 목록 ────────────────────────────────────────────────────────────
const DONG_LIST = [
  "전체","상인동","진천동","월성동","죽전동","감삼동",
  "본리동","대곡동","본동","이곡동","유천동",
];

const CATEGORIES = ["전체","한식","고기","면/국수","카페","일식","중식","분식","야식"];

// ── Mock 데이터 (Firestore 미연결 fallback) ────────────────────────────────────
const MOCK: Restaurant[] = [
  { id:"1", name:"송정칼국수 본점", dong:"진천동", rating:4.6, reviewCount:1204, saveCount:342, trendScore:65, trendDirection:"up", trendLabel:"↑ Rising", keywords:["주차편리","국물맛","양많음"], blogMentions:{days7:12,days30:45,days90:110}, isNew:false, isAiPick:false, authenticityFlag:true, category:"면/국수" },
  { id:"2", name:"강철돼지", dong:"상인동", rating:4.8, reviewCount:876, saveCount:520, trendScore:82, trendDirection:"up", trendLabel:"🔥 Trending", keywords:["목살","단백질","운동후"], blogMentions:{days7:31,days30:89,days90:180}, isNew:false, isAiPick:true, authenticityFlag:true, category:"고기" },
  { id:"3", name:"쿠시 감삼", dong:"감삼동", rating:4.7, reviewCount:342, saveCount:890, trendScore:91, trendDirection:"up", trendLabel:"🔥 Trending", keywords:["텐동","20대","핫플","인스타"], blogMentions:{days7:48,days30:95,days90:120}, isNew:true, isAiPick:true, authenticityFlag:true, category:"일식" },
  { id:"4", name:"영양가득 칼국수", dong:"진천동", rating:4.5, reviewCount:210, saveCount:115, trendScore:44, trendDirection:"stable", trendLabel:"→ Stable", keywords:["닭가슴살","건강식","주차가능"], blogMentions:{days7:5,days30:18,days90:55}, isNew:false, isAiPick:false, authenticityFlag:true, category:"면/국수" },
  { id:"5", name:"아눅 델리", dong:"대곡동", rating:4.6, reviewCount:445, saveCount:2500, trendScore:78, trendDirection:"up", trendLabel:"↑ Rising", keywords:["브런치","커피","감성","여성"], blogMentions:{days7:22,days30:67,days90:140}, isNew:false, isAiPick:true, authenticityFlag:true, category:"카페" },
  { id:"6", name:"죽전 면옥", dong:"죽전동", rating:4.4, reviewCount:189, saveCount:88, trendScore:28, trendDirection:"stable", trendLabel:"→ Stable", keywords:["냉면","여름","줄서는"], blogMentions:{days7:3,days30:12,days90:40}, isNew:false, isAiPick:false, authenticityFlag:true, category:"한식" },
  { id:"7", name:"본리 가든", dong:"본리동", rating:4.2, reviewCount:520, saveCount:210, trendScore:35, trendDirection:"stable", trendLabel:"→ Stable", keywords:["회식","주차50대","단체석"], blogMentions:{days7:7,days30:28,days90:95}, isNew:false, isAiPick:false, authenticityFlag:true, category:"고기" },
  { id:"8", name:"월성 삼계탕", dong:"월성동", rating:4.3, reviewCount:267, saveCount:145, trendScore:38, trendDirection:"stable", trendLabel:"→ Stable", keywords:["보양식","여름","원기회복"], blogMentions:{days7:6,days30:22,days90:70}, isNew:false, isAiPick:false, authenticityFlag:true, category:"한식" },
  { id:"9", name:"월배 정나루", dong:"상인동", rating:4.5, reviewCount:388, saveCount:175, trendScore:51, trendDirection:"up", trendLabel:"↑ Rising", keywords:["저장급증","가성비","점심"], blogMentions:{days7:9,days30:31,days90:80}, isNew:false, isAiPick:false, authenticityFlag:true, category:"한식" },
  { id:"10", name:"소문난 손칼국수", dong:"죽전동", rating:4.8, reviewCount:920, saveCount:430, trendScore:73, trendDirection:"up", trendLabel:"↑ Rising", keywords:["실방문자","손칼국수","줄서는"], blogMentions:{days7:18,days30:55,days90:130}, isNew:false, isAiPick:true, authenticityFlag:true, category:"면/국수" },
  { id:"11", name:"감삼동 새마을식당", dong:"감삼동", rating:4.1, reviewCount:312, saveCount:95, trendScore:22, trendDirection:"down", trendLabel:"↓ Cooling", keywords:["고기","회식","저렴"], blogMentions:{days7:2,days30:9,days90:45}, isNew:false, isAiPick:false, authenticityFlag:true, category:"고기" },
  { id:"12", name:"진천 양꼬치", dong:"진천동", rating:4.4, reviewCount:156, saveCount:320, trendScore:67, trendDirection:"up", trendLabel:"↑ Rising", keywords:["양꼬치","마라","20대","신흥핫플"], blogMentions:{days7:19,days30:44,days90:60}, isNew:true, isAiPick:true, authenticityFlag:true, category:"중식" },
];

// ── 날씨 유틸 ──────────────────────────────────────────────────────────────────
function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 6)  return "새벽";
  if (h < 11) return "오전";
  if (h < 14) return "점심";
  if (h < 18) return "오후";
  if (h < 22) return "저녁";
  return "야식";
}

// ── 트렌드 뱃지 컬러 ──────────────────────────────────────────────────────────
function trendBadgeClass(dir?: string): string {
  if (dir === "up")   return "bg-emerald-100 text-emerald-800";
  if (dir === "down") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function scoreBg(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-400";
  if (score >= 25) return "bg-orange-300";
  return "bg-slate-300";
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [restaurants, setRestaurants] = useState<Restaurant[]>(MOCK);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [briefing, setBriefing] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [timeStr, setTimeStr] = useState("");

  // 필터 상태
  const [filterDong, setFilterDong]     = useState("전체");
  const [filterCat, setFilterCat]       = useState("전체");
  const [sortKey, setSortKey]           = useState<"trendScore"|"rating"|"reviewCount">("trendScore");

  // 채팅 상태
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([
    { role:"ai", text:"안녕하세요! 달서구 맛집 추천 AI입니다 🍽️\n\"비 오는 날 주차 편한 국수집\", \"감삼동 20대 핫플\" 같이 자유롭게 물어보세요." }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── 데이터 로드 ────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit" }));
    }, 60000);
    setTimeStr(new Date().toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit" }));
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 식당 목록
        const rSnap = await getDocs(
          query(collection(db, "restaurants"), orderBy("trendScore","desc"), limit(50))
        );
        if (!rSnap.empty) {
          setRestaurants(rSnap.docs.map(d => ({ id: d.id, ...d.data() } as Restaurant)));
        }
        // 트렌드
        const tSnap = await getDocs(
          query(collection(db, "trends"), orderBy("score","desc"), limit(10))
        );
        if (!tSnap.empty) {
          setTrends(tSnap.docs.map(d => ({ id: d.id, ...d.data() } as TrendItem)));
        }
        // 오늘 브리핑
        const todayKey = new Date().toLocaleDateString("ko-KR", {
          timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit"
        }).replace(/\. /g,"-").replace(".","");
        const bDoc = await getDoc(doc(db, "briefings", todayKey));
        if (bDoc.exists()) setBriefing((bDoc.data() as any).briefing ?? "");
      } catch {
        // Firestore 연결 실패 시 Mock 유지
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [chatHistory, chatLoading]);

  // ── Claude AI 채팅 ────────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatHistory(p => [...p, { role:"user", text:userMsg }]);
    setChatLoading(true);

    try {
      // API 서버 경유 (server.ts의 /api/chat)
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          message: userMsg,
          timeOfDay: getTimeOfDay(),
        }),
      });
      const json = await res.json();
      setChatHistory(p => [...p, { role:"ai", text: json.reply ?? "추천을 불러오지 못했습니다." }]);
    } catch {
      // 직접 Claude API 호출 (개발 모드 fallback)
      try {
        const top = [...restaurants].sort((a,b)=>(b.trendScore??0)-(a.trendScore??0)).slice(0,15);
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            model:"claude-sonnet-4-6",
            max_tokens:600,
            system:`너는 대구시 달서구 맛집 추천 AI야.
반드시 아래 실제 데이터를 기반으로만 추천해. 데이터에 없는 식당은 추천하지 마.
트렌드 스코어, 별점, 키워드를 근거로 추천 이유를 구체적으로 설명해.
한국어로, 친근하고 간결하게. 식당 3곳 이내.`,
            messages:[{
              role:"user",
              content:`[시간대] ${getTimeOfDay()}\n[요청] ${userMsg}\n\n[달서구 맛집 실데이터]\n${JSON.stringify(top,null,2)}`
            }]
          })
        });
        const data = await response.json();
        const reply = data.content?.[0]?.text ?? "죄송합니다, 잠시 후 다시 시도해주세요.";
        setChatHistory(p => [...p, { role:"ai", text:reply }]);
      } catch {
        setChatHistory(p => [...p, { role:"ai", text:"네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }]);
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, restaurants]);

  // ── 필터된 식당 목록 ──────────────────────────────────────────────────────
  const filtered = restaurants
    .filter(r => filterDong === "전체" || r.dong === filterDong)
    .filter(r => filterCat  === "전체" || r.category === filterCat)
    .sort((a,b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  const top3     = [...restaurants].sort((a,b)=>(b.trendScore??0)-(a.trendScore??0)).slice(0,3);
  const newOnes  = restaurants.filter(r => r.isNew);
  const aiPicks  = restaurants.filter(r => r.isAiPick);

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F4F6F8] font-sans text-slate-800">

      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <span className="text-xl">🍽️</span>
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-none">달서맛집</h1>
                <p className="text-[10px] text-slate-400 mt-0.5">대구 달서구 실시간 맛집 분석</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="hidden sm:flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
              <span className="font-medium">{timeStr}</span>
            </div>
          </div>

          {/* 탭 */}
          <div className="flex gap-1 pb-0">
            {(["dashboard","new","ranking","chat"] as Tab[]).map(t => {
              const labels: Record<Tab,string> = {
                dashboard:"대시보드", new:"신규 맛집", ranking:"랭킹", chat:"AI 추천"
              };
              const icons: Record<Tab,string> = {
                dashboard:"📊", new:"🆕", ranking:"🏆", chat:"🤖"
              };
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                    ${tab === t
                      ? "border-emerald-500 text-emerald-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"}`}
                >
                  <span>{icons[t]}</span>
                  <span>{labels[t]}</span>
                  {t === "new" && newOnes.length > 0 && (
                    <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                      {newOnes.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* ── 대시보드 탭 ── */}
        {tab === "dashboard" && (
          <div className="space-y-6">

            {/* 오늘의 핫플 TOP3 */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold">🔥 오늘의 핫플 TOP3</h2>
                <span className="text-xs text-slate-400">트렌드 스코어 기준</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {top3.map((r, i) => (
                  <div key={r.id}
                    className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <span className={`text-3xl font-black ${i === 0 ? "text-emerald-500" : "text-slate-300"}`}>
                        {String(i+1).padStart(2,"0")}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${trendBadgeClass(r.trendDirection)}`}>
                        {r.trendLabel}
                      </span>
                    </div>
                    <h3 className="font-bold text-base mb-1">{r.name}</h3>
                    <p className="text-xs text-slate-500 mb-3">달서구 {r.dong}</p>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {r.keywords?.slice(0,3).map(k => (
                        <span key={k} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{k}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>⭐ {r.rating}</span>
                      <span>💬 {r.reviewCount?.toLocaleString()}</span>
                      <span>🔖 {r.saveCount?.toLocaleString()}</span>
                    </div>
                    {/* 트렌드 스코어 바 */}
                    <div className="mt-3">
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>트렌드 지수</span>
                        <span className="font-bold text-slate-700">{r.trendScore}</span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${scoreBg(r.trendScore??0)}`}
                          style={{ width:`${r.trendScore}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* AI 브리핑 */}
            {briefing && (
              <section className="bg-slate-900 text-white rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest">
                    Claude AI 브리핑
                  </span>
                  <span className="text-slate-500 text-xs">오늘의 분석</span>
                </div>
                <pre className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">
                  {briefing}
                </pre>
              </section>
            )}

            {/* AI PICK 식당 */}
            <section>
              <h2 className="text-lg font-bold mb-3">✨ AI Pick 맛집</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {aiPicks.slice(0,4).map(r => (
                  <div key={r.id}
                    className="bg-white rounded-xl p-4 border border-emerald-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[10px] bg-emerald-500 text-white font-bold px-1.5 py-0.5 rounded">AI Pick</span>
                      {r.isNew && <span className="text-[10px] bg-red-500 text-white font-bold px-1.5 py-0.5 rounded">NEW</span>}
                    </div>
                    <h3 className="font-bold text-sm">{r.name}</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">{r.dong}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <span className="text-amber-500">★ {r.rating}</span>
                      <span className="text-slate-400">|</span>
                      <span className={`font-bold text-[11px] ${trendBadgeClass(r.trendDirection)} px-1.5 py-0.5 rounded-full`}>
                        {r.trendScore}점
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 실시간 트렌드 리스트 */}
            <section>
              <h2 className="text-lg font-bold mb-3">📈 실시간 트렌드 분석</h2>
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {(trends.length > 0 ? trends : restaurants
                  .sort((a,b)=>(b.trendScore??0)-(a.trendScore??0))
                  .slice(0,6)
                  .map((r,i) => ({
                    id: r.id, restaurantId: r.id, name: r.name, dong: r.dong,
                    score: r.trendScore??0, trendDirection: r.trendDirection??"stable",
                    reason: r.keywords?.slice(0,2).join(" · ") ?? "",
                  }))
                ).map((t, i) => (
                  <div key={t.id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-slate-50" : ""} hover:bg-slate-50 transition-colors`}>
                    <span className={`font-mono font-black text-xl min-w-[2ch] ${i === 0 ? "text-emerald-500" : "text-slate-200"}`}>
                      {String(i+1).padStart(2,"0")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm">{t.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{t.reason}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${trendBadgeClass(t.trendDirection)}`}>
                        {t.score}점
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1">{t.dong}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── 신규 맛집 탭 ── */}
        {tab === "new" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">🆕 신규 오픈 맛집</h2>
                <p className="text-sm text-slate-500 mt-1">최근 30일 내 오픈 또는 리뷰 급증</p>
              </div>
              <span className="bg-red-100 text-red-700 text-sm font-bold px-3 py-1.5 rounded-full">
                {newOnes.length}곳
              </span>
            </div>

            {newOnes.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-100">
                <p className="text-4xl mb-3">🔍</p>
                <p>이번 달 신규 오픈 식당 데이터가 없습니다.</p>
                <p className="text-sm mt-1">크롤러 실행 후 데이터가 쌓이면 표시됩니다.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {newOnes.map(r => (
                  <div key={r.id}
                    className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-red-50 rounded-bl-[3rem]" />
                    <div className="relative">
                      <div className="flex items-start justify-between mb-3">
                        <span className="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-lg">🆕 NEW OPEN</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${trendBadgeClass(r.trendDirection)}`}>
                          {r.trendLabel}
                        </span>
                      </div>
                      <h3 className="font-bold text-lg mt-2">{r.name}</h3>
                      <p className="text-sm text-slate-500 mb-3">📍 달서구 {r.dong} {r.category && `· ${r.category}`}</p>

                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {r.keywords?.map(k => (
                          <span key={k} className="text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium">{k}</span>
                        ))}
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                          { label:"별점", value: r.rating ? `★${r.rating}` : "-" },
                          { label:"리뷰", value: r.reviewCount?.toLocaleString() ?? "-" },
                          { label:"저장", value: r.saveCount?.toLocaleString() ?? "-" },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-slate-50 rounded-xl p-2">
                            <p className="text-xs text-slate-400">{label}</p>
                            <p className="font-bold text-sm mt-0.5">{value}</p>
                          </div>
                        ))}
                      </div>

                      {r.blogMentions && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <p className="text-[10px] text-slate-400 mb-1.5">블로그 언급량</p>
                          <div className="flex gap-2 text-xs">
                            <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded">7일 {r.blogMentions.days7}건</span>
                            <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded">30일 {r.blogMentions.days30}건</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 랭킹 탭 ── */}
        {tab === "ranking" && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">🏆 달서구 맛집 랭킹</h2>

            {/* 필터 바 */}
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-500 self-center mr-1">동</span>
                {DONG_LIST.map(d => (
                  <button key={d}
                    onClick={() => setFilterDong(d)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors
                      ${filterDong === d ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {d}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-500 self-center mr-1">카테고리</span>
                {CATEGORIES.map(c => (
                  <button key={c}
                    onClick={() => setFilterCat(c)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors
                      ${filterCat === c ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <span className="text-xs font-bold text-slate-500 self-center mr-1">정렬</span>
                {(["trendScore","rating","reviewCount"] as const).map(k => {
                  const labels = { trendScore:"트렌드", rating:"별점", reviewCount:"리뷰수" };
                  return (
                    <button key={k}
                      onClick={() => setSortKey(k)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors
                        ${sortKey === k ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                      {labels[k]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 결과 수 */}
            <p className="text-sm text-slate-500">{filtered.length}곳</p>

            {/* 랭킹 테이블 */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              {filtered.map((r, i) => (
                <div key={r.id}
                  className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-slate-50" : ""} hover:bg-slate-50 transition-colors`}>
                  {/* 순위 */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0
                    ${i===0 ? "bg-amber-400 text-white"
                    : i===1 ? "bg-slate-300 text-white"
                    : i===2 ? "bg-orange-300 text-white"
                    : "bg-slate-100 text-slate-500"}`}>
                    {i+1}
                  </div>
                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{r.name}</span>
                      {r.isNew && <span className="text-[9px] bg-red-500 text-white font-bold px-1.5 py-0.5 rounded">NEW</span>}
                      {r.isAiPick && <span className="text-[9px] bg-emerald-500 text-white font-bold px-1.5 py-0.5 rounded">AI Pick</span>}
                      {!r.authenticityFlag && <span className="text-[9px] bg-orange-400 text-white font-bold px-1.5 py-0.5 rounded">광고의심</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                      <span>{r.dong}</span>
                      {r.category && <><span>·</span><span>{r.category}</span></>}
                    </div>
                  </div>
                  {/* 지표 */}
                  <div className="hidden sm:flex items-center gap-4 text-sm shrink-0">
                    <div className="text-center">
                      <p className="text-amber-500 font-bold">★ {r.rating ?? "-"}</p>
                      <p className="text-[10px] text-slate-400">별점</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{r.reviewCount?.toLocaleString() ?? "-"}</p>
                      <p className="text-[10px] text-slate-400">리뷰</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{r.saveCount?.toLocaleString() ?? "-"}</p>
                      <p className="text-[10px] text-slate-400">저장</p>
                    </div>
                  </div>
                  {/* 트렌드 스코어 */}
                  <div className="shrink-0 text-right">
                    <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${trendBadgeClass(r.trendDirection)}`}>
                      {r.trendScore}점
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="py-16 text-center text-slate-400">
                  <p>해당 조건의 맛집이 없습니다.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AI 채팅 탭 ── */}
        {tab === "chat" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-4">
              <h2 className="text-xl font-bold">🤖 AI 맛집 추천</h2>
              <p className="text-sm text-slate-500 mt-1">달서구 실데이터 기반 · Claude AI</p>
            </div>

            {/* 빠른 질문 */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                "오늘 점심 추천해줘",
                "감삼동 20대 핫플",
                "주차 편한 고기집",
                "혼밥하기 좋은 곳",
                "신규 오픈 맛집",
              ].map(q => (
                <button key={q}
                  onClick={() => { setChatInput(q); }}
                  className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:border-emerald-400 hover:text-emerald-700 transition-colors">
                  {q}
                </button>
              ))}
            </div>

            {/* 채팅창 */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col" style={{ height:"60vh", minHeight:"400px" }}>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "ai" && (
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-sm mr-2 shrink-0 mt-1">
                        🤖
                      </div>
                    )}
                    <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                      ${msg.role === "user"
                        ? "bg-emerald-600 text-white rounded-tr-sm"
                        : "bg-slate-50 text-slate-800 border border-slate-100 rounded-tl-sm"}`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-sm mr-2 shrink-0">🤖</div>
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1">
                      {[0,150,300].map(d => (
                        <span key={d} className="w-2 h-2 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay:`${d}ms` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* 입력창 */}
              <div className="p-4 border-t border-slate-100">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
                    placeholder="예: 비 오는 날 칼국수 추천해줘"
                    disabled={chatLoading}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                  />
                  <button
                    onClick={sendChat}
                    disabled={!chatInput.trim() || chatLoading}
                    className="bg-emerald-600 text-white px-4 py-3 rounded-xl font-medium text-sm hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    전송
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 text-center">
                  Claude AI가 달서구 실데이터({restaurants.length}개 식당)를 기반으로 추천합니다
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 푸터 */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-6 mt-4 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-400">
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              네이버 크롤링: {loading ? "동기화 중..." : "정상"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Claude AI 분석: 매일 09:00 / 18:00
            </span>
          </div>
          <span>달서구청 사회적경제팀 · 달서맛집 v2</span>
        </div>
      </footer>
    </div>
  );
}
