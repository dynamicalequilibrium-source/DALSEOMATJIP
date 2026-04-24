import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { db } from './firebase';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

// Mock data to seed the UI before real db fetches, mirroring the design
const MOCK_RECOMMENDATIONS = [
  { id: '1', name: '송정칼국수 본점', location: '진천동', context: '비 오는 날의 칼국수', description: '방문자 리뷰 1,204', tag: '주차 편리', isAiPick: false, rating: 4.6 },
  { id: '2', name: '월배 정나루', location: '상인동', context: '비 오는 날의 칼국수', description: '저장수 급증 (+42%)', tag: '', isAiPick: false, rating: 4.5 },
  { id: '3', name: '소문난 손칼국수', location: '죽전동', context: '비 오는 날의 칼국수', description: '실방문자 평점 4.8', tag: 'AI Pick', isAiPick: true, rating: 4.8 },
];

const MOCK_ALL_RESTAURANTS = [
  ...MOCK_RECOMMENDATIONS,
  { id: '4', name: '영양가득 칼국수', location: '진천동', context: '건강식', description: '닭가슴살 산더미, 단백질 보충에 최고', tag: '러너 추천', isAiPick: true, rating: 4.7 },
  { id: '5', name: '강철돼지', location: '상인동', context: '육류/고기', description: '지방이 적은 목살 전문, 단백질 식단', tag: '단백질 폭발', isAiPick: true, rating: 4.8 },
  { id: '6', name: '월성 삼계탕', location: '월성동', context: '보양식', description: '원기 회복 삼계탕 전문점', tag: '몸보신', isAiPick: false, rating: 4.3 },
  { id: '7', name: '아눅 델리', location: '대곡동', context: '카페/디저트', description: '여유로운 브런치 & 커피', tag: '브런치', isAiPick: false, rating: 4.6 },
  { id: '8', name: '쿠시 감삼', location: '감삼동', context: '일식/텐동', description: '바삭한 텐동과 시원한 생맥주', tag: '핫플', isAiPick: true, rating: 4.7 },
  { id: '9', name: '죽전 면옥', location: '죽전동', context: '냉면', description: '시원하고 쫄깃한 냉면 전문점', tag: '여름 별미', isAiPick: false, rating: 4.4 },
  { id: '10', name: '본리 가든', location: '본리동', context: '육류/고기', description: '넓은 회식 공간과 넉넉한 주차장', tag: '회식 명소', isAiPick: false, rating: 4.2 },
];

const MOCK_TRENDS = [
  { id: '1', name: "감삼동 텐동 전문점 '쿠시'", reason: '블로그 언급량 300% 증가 • 20대 여성 선호', status: 'Trending 🔥', type: 'up' },
  { id: '2', name: "대곡동 브런치 카페 '아눅'", reason: '평일 점심 예약 불가 • 저장수 2.5k', status: '+12% vs Yesterday', type: 'up' },
  { id: '3', name: "본리동 대형 고깃집 '가든'", reason: '회식 키워드 급증 • 주차 공간 50대 확보', status: 'Stable', type: 'stable' },
];

const DONG_LIST = ['전체', '상인동', '진천동', '월성동', '죽전동', '감삼동', '본리동', '대곡동'];

type Tab = 'dashboard' | 'list';

export default function App() {
  const [time, setTime] = useState<string>('');
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedDong, setSelectedDong] = useState<string>('전체');
  
  const [chatQuery, setChatQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([
    { role: 'user', text: '"오늘 비 오는데 주차 편한 칼국수집 알려줘"' },
    { role: 'ai', text: '대구 달서구 진천동에 위치한 "송정칼국수 본점"을 추천합니다. 매장 앞 주차장이 넓고, 비 오는 날 따뜻한 국물이 일품이라는 리뷰가 많습니다.' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [recommendations, setRecommendations] = useState(MOCK_RECOMMENDATIONS);
  const [trends, setTrends] = useState(MOCK_TRENDS);
  const [allRestaurants, setAllRestaurants] = useState(MOCK_ALL_RESTAURANTS);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const restQuery = query(collection(db, 'restaurants'), orderBy('createdAt', 'desc'), limit(3));
        const restSnapshot = await getDocs(restQuery);
        if (!restSnapshot.empty) {
          const fetchedRecs = restSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as any[];
          // Update recommendations if we have real data
          // setRecommendations(fetchedRecs);
        }

        const trendQuery = query(collection(db, 'trends'), orderBy('score', 'desc'), limit(3));
        const trendSnapshot = await getDocs(trendQuery);
        if (!trendSnapshot.empty) {
          const fetchedTrends = trendSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as any[];
          // setTrends(fetchedTrends);
        }
      } catch (err) {
        console.log("Firestore not fully configured or empty. Using mock data.");
      }
    };
    fetchData();
  }, []);


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isTyping]);

  const handleAskGemini = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuery.trim() || isTyping) return;

    const userMessage = chatQuery;
    setChatQuery('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsTyping(true);

    try {
      // In a real app we might fetch context from Firestore first to feed into Gemini
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are a friendly AI restaurant recommender for Dalseo-gu, Daegu. Respond in Korean. User asks: ${userMessage}`,
      });
      
      setChatHistory(prev => [...prev, { role: 'ai', text: response.text || '추천을 불러오는 중 오류가 발생했습니다.' }]);
    } catch (error) {
      console.error("Gemini Error:", error);
      setChatHistory(prev => [...prev, { role: 'ai', text: '죄송합니다. 현재 AI 응답 시스템에 일시적인 장애가 있습니다.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  const filteredRestaurants = selectedDong === '전체' 
    ? allRestaurants 
    : allRestaurants.filter(r => r.location === selectedDong);

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col font-sans text-slate-800 p-4 sm:p-8">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dalseo Gourmet Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">대구광역시 달서구 실시간 맛집 분석</p>
          
          <div className="flex gap-2 mt-4 bg-slate-200/50 p-1 rounded-lg w-fit">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              대시보드
            </button>
            <button 
              onClick={() => setActiveTab('list')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              맛집 리스트
            </button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4 sm:gap-6 text-right mt-4 sm:mt-0">
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-slate-200 shadow-sm transition-all hover:shadow-md">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            <span className="text-sm font-medium">현재 날씨: 비 (Rainy)</span>
            <span className="text-slate-400">|</span>
            <span className="text-sm font-medium">18°C</span>
          </div>
          <div className="text-sm flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span className="text-slate-400">Last updated:</span>
            <span className="font-semibold text-slate-700">{time || 'Loading...'}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      {activeTab === 'dashboard' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
          
          {/* Left Column (8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Recommendation Card */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm transition-all hover:shadow-md h-[auto]">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-2">
              <h2 className="text-lg font-bold">오늘의 추천: <span className="text-emerald-600">비 오는 날의 칼국수</span></h2>
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400 bg-slate-50 px-3 py-1 rounded-full">Context Match: 98%</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {recommendations.map((rec) => (
                <div key={rec.id} className="group cursor-pointer flex flex-col outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-2xl" tabIndex={0}>
                  <div className="aspect-[4/3] bg-slate-100 rounded-2xl mb-4 overflow-hidden relative border border-slate-50 shadow-inner">
                    <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-300"></div>
                    {rec.tag && (
                      <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide shadow-sm
                        ${rec.isAiPick ? 'bg-emerald-500 text-white' : 'bg-white/90 text-slate-700'}`}>
                        {rec.tag}
                      </div>
                    )}
                  </div>
                  <h3 className="font-bold text-sm text-slate-800 group-hover:text-emerald-700 transition-colors">{rec.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{rec.location} • {rec.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Trending Card */}
          <div className="flex-1 bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col transition-all hover:shadow-md">
            <h2 className="text-lg font-bold mb-6 text-slate-900">실시간 트렌드 분석 <span className="text-slate-400 font-normal text-sm ml-2">(Rising Hotspots)</span></h2>
            <div className="space-y-4 overflow-y-auto pr-2">
              {trends.map((trend, idx) => (
                <div key={trend.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl transition-colors
                  ${idx === 0 ? 'bg-slate-50 border border-slate-200' : 'border border-slate-100 hover:bg-slate-50'}`}>
                  <div className="flex items-start sm:items-center gap-4 mb-2 sm:mb-0">
                    <span className={`font-mono font-bold text-lg min-w-[2ch] ${idx === 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{trend.name}</p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{trend.reason}</p>
                    </div>
                  </div>
                  <div className={`text-right text-xs font-bold whitespace-nowrap self-end sm:self-auto ${idx === 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {trend.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6 h-[800px] lg:h-auto">
          
          {/* Analytics Summary */}
          <div className="bg-slate-900 text-white rounded-3xl p-7 flex flex-col shadow-xl flex-shrink-0 relative overflow-hidden group">
            {/* Decorative gradient blob */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl group-hover:bg-emerald-500/30 transition-all duration-700 ease-in-out"></div>
            
            <div className="mb-8 relative z-10">
              <span className="inline-block bg-white/10 text-emerald-300 border border-emerald-400/20 text-[10px] px-3 py-1.5 rounded-full uppercase tracking-widest font-bold shadow-sm">
                Review Analytics
              </span>
              <h3 className="text-xl sm:text-2xl font-medium mt-6 leading-normal tracking-wide text-white/90">
                달서구 식당들은 <br/>
                <span className="text-emerald-400 font-bold italic tracking-normal relative inline-block group-hover:text-emerald-300 transition-colors">
                  "친절함"
                  <div className="absolute bottom-1 left-0 w-full h-[3px] bg-emerald-400/30 rounded-full"></div>
                </span>과 <br/>
                <span className="text-emerald-400 font-bold italic tracking-normal relative inline-block mt-1 group-hover:text-emerald-300 transition-colors">
                  "가성비"
                  <div className="absolute bottom-1 left-0 w-full h-[3px] bg-emerald-400/30 rounded-full"></div>
                </span>가 <br/>
                핵심 키워드입니다.
              </h3>
            </div>
            <div className="mt-auto pt-6 border-t border-white/10 relative z-10">
              <div className="flex justify-between text-xs mb-2 font-medium">
                <span className="text-white/60">신뢰도 높은 리뷰 비율</span>
                <span className="text-emerald-400">84%</span>
              </div>
              <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden shadow-inner">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-300 h-full w-[84%] rounded-full relative">
                  <div className="absolute inset-0 bg-white/20 animate-[pulse_2s_ease-in-out_infinite]"></div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Chat Card */}
          <div className="bg-emerald-50/50 rounded-3xl p-6 flex-1 flex flex-col border border-emerald-100 shadow-sm relative overflow-hidden min-h-[300px]">
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent pointer-events-none"></div>
            
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-emerald-950">대화형 쿼리</h3>
              </div>
              
              <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-2">
                {chatHistory.map((msg, idx) => (
                  <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`px-4 py-3 rounded-2xl max-w-[90%] text-sm leading-relaxed shadow-sm
                      ${msg.role === 'user' 
                        ? 'bg-emerald-600 text-white rounded-tr-sm' 
                        : 'bg-white text-slate-700 border border-emerald-100 rounded-tl-sm'}`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-start">
                    <div className="px-4 py-3 rounded-2xl bg-white text-slate-400 border border-emerald-100 rounded-tl-sm shadow-sm flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{animationDelay: '0ms'}}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{animationDelay: '150ms'}}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{animationDelay: '300ms'}}></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              
              <form onSubmit={handleAskGemini} className="relative mt-auto">
                <input 
                  type="text" 
                  value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)}
                  placeholder="질문을 입력하세요..." 
                  className="w-full bg-white border border-emerald-200 rounded-2xl py-3.5 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm transition-all text-slate-800 placeholder:text-slate-400"
                  disabled={isTyping}
                />
                <button 
                  type="submit"
                  disabled={!chatQuery.trim() || isTyping}
                  className="absolute right-2 top-2 bottom-2 aspect-square bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors flex items-center justify-center shadow-sm"
                >
                  <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                  </svg>
                </button>
              </form>
            </div>
          </div>
        </div>
        </div>
      ) : (
        /* Restaurant List View */
        <div className="flex flex-col flex-1 gap-6 bg-white rounded-3xl p-6 border border-slate-100 shadow-sm min-h-0">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-xl font-bold text-slate-900">맛집 탐색</h2>
            
            {/* Filter Pills */}
            <div className="flex flex-wrap gap-2">
              {DONG_LIST.map(dong => (
                <button
                  key={dong}
                  onClick={() => setSelectedDong(dong)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors
                    ${selectedDong === dong 
                      ? 'bg-emerald-600 text-white shadow-sm' 
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                >
                  {dong}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 content-start pb-4">
            {filteredRestaurants.map(rec => (
              <div key={rec.id} className="group flex flex-col h-full bg-white rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 border border-slate-100 hover:border-emerald-200 shadow-sm hover:shadow-md transition-all overflow-hidden" tabIndex={0}>
                <div className="aspect-[4/3] bg-slate-100 relative overflow-hidden">
                  <div className="absolute inset-0 bg-emerald-900/5 group-hover:bg-transparent transition-colors duration-300"></div>
                  {rec.tag && (
                    <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide shadow-sm z-10
                      ${rec.isAiPick ? 'bg-emerald-500 text-white' : 'bg-white/95 text-slate-800'}`}>
                      {rec.tag}
                    </div>
                  )}
                  {/* Rating Badge */}
                  {rec.rating && (
                    <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur text-slate-800 px-2 py-1 rounded-md text-xs font-bold shadow-sm flex items-center gap-1 z-10">
                      <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      {rec.rating}
                    </div>
                  )}
                </div>
                <div className="p-4 flex flex-col flex-1">
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <h3 className="font-bold text-base text-slate-800 group-hover:text-emerald-700 transition-colors line-clamp-1">{rec.name}</h3>
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap">{rec.context}</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mb-2 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    대구 달서구 {rec.location}
                  </p>
                  <p className="text-sm text-slate-600 mt-auto line-clamp-2 leading-relaxed">{rec.description}</p>
                </div>
              </div>
            ))}
            {filteredRestaurants.length === 0 && (
              <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-400">
                <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p>해당 동의 데이터가 없습니다.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-8 pt-6 border-t border-slate-200/60 flex flex-col sm:flex-row justify-between items-center text-[10px] text-slate-400 uppercase tracking-widest gap-4">
        <div className="flex flex-wrap justify-center gap-4 font-semibold text-slate-500">
          <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>Naver API Sync: Active</span>
          <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>Data Refresh: 15m</span>
        </div>
        <div className="text-center sm:text-right text-slate-400/80">
          Powered by Gemini Pro & Playwright Analytics
        </div>
      </footer>
    </div>
  );
}
