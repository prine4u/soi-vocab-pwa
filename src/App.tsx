import { useEffect, useMemo, useState } from 'react';
import { Rating, type Grade } from 'ts-fsrs';
import { Trophy, RefreshCw } from 'lucide-react';
import type { VocabCard } from './types/vocab';
import { applyReview, createVocabCard } from './lib/fsrsEngine';
import { FlashcardView } from './components/FlashcardView';

const STORAGE_KEY = 'soi_vocab_cards_v1';

// 초기 테스트용 샘플 단어장
const INITIAL_SAMPLE_CARDS: VocabCard[] = [
  createVocabCard('1', 'curious', '호기심이 많은', 'The little cat was very curious.', '그 작은 고양이는 호기심이 아주 많았다.'),
  createVocabCard('2', 'brave', '용감한', 'You are a brave girl.', '너는 용감한 소녀야.'),
  createVocabCard('3', 'discover', '발견하다', 'We will discover a secret cave.', '우리는 비밀 동굴을 발견할 것이다.'),
  createVocabCard('4', 'precious', '소중한', 'Family is the most precious thing.', '가족은 가장 소중한 것이다.'),
];

export default function App() {
  // [데이터 불러오기 영역] 추후 Supabase DB에서 가져오도록 교체할 위치
  const [cards, setCards] = useState<VocabCard[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return INITIAL_SAMPLE_CARDS;
    const parsed: VocabCard[] = JSON.parse(saved);
    // JSON 직렬화로 문자열이 된 Date 필드를 다시 Date 객체로 복원
    return parsed.map((c) => ({
      ...c,
      fsrsCard: {
        ...c.fsrsCard,
        due: new Date(c.fsrsCard.due),
        last_review: c.fsrsCard.last_review ? new Date(c.fsrsCard.last_review) : undefined,
      },
    }));
  });

  const [streak, setStreak] = useState(0);

  // [데이터 저장 영역] 추후 Supabase DB 업데이트로 교체할 위치
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }, [cards]);

  // 현재 시각 기준으로 복습 기한(due)이 도래한 카드만 필터링
  const dueCards = useMemo(() => {
    const now = new Date();
    return cards.filter((c) => new Date(c.fsrsCard.due) <= now);
  }, [cards]);

  const handleRate = (grade: Grade) => {
    const targetCard = dueCards[0];
    if (!targetCard) return;

    // '다시(Again)'를 누르면 콤보 초기화, 그 외에는 연속 정답 증가
    setStreak((prev) => (grade === Rating.Again ? 0 : prev + 1));

    const updated = applyReview(targetCard, grade);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleResetDemo = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCards(INITIAL_SAMPLE_CARDS);
    setStreak(0);
  };

  return (
      <main className="h-dvh w-full bg-slate-50 overflow-hidden">
        {dueCards.length > 0 ? (
            <FlashcardView
                card={dueCards[0]}
                currentIndex={cards.length - dueCards.length}
                totalCount={cards.length}
                streak={streak}
                onRate={handleRate}
            />
        ) : (
            <div className="h-full max-w-md mx-auto px-6 flex flex-col items-center justify-center text-center space-y-5">
              <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center text-amber-500">
                <Trophy className="w-10 h-10" />
              </div>
              <h1 className="text-2xl font-extrabold text-slate-800">오늘의 단어 학습 완료!</h1>
              <p className="text-slate-500 text-sm leading-relaxed">
                FSRS 알고리즘이 소이의 기억 곡선을 계산해서<br />
                가장 기억하기 좋은 날에 다시 알려줄게요.
              </p>
              <button
                  onClick={handleResetDemo}
                  className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-sm transition"
              >
                <RefreshCw className="w-4 h-4" /> 테스트용 카드 초기화
              </button>
            </div>
        )}
      </main>
  );
}