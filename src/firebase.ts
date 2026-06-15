import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// 환경변수 우선, 없으면 기존 JSON config fallback
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY       ?? "AIzaSyBhh-koPDBx2LG_-Na6wnV2mmiiXpHW4jI",
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN   ?? "gen-lang-client-0585204413.firebaseapp.com",
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID    ?? "gen-lang-client-0585204413",
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE       ?? "gen-lang-client-0585204413.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID     ?? "914250995391",
  appId:             import.meta.env.VITE_FIREBASE_APP_ID        ?? "1:914250995391:web:381ce5723f0db294f9580a",
};

const firestoreDatabaseId =
  import.meta.env.VITE_FIREBASE_DATABASE_ID ?? "ai-studio-ea985f3f-4cc2-449d-bfe4-c1fba9f8e023";

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

export const db   = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
export default app;
