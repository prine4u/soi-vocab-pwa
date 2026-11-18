import { useEffect, useState } from 'react';
import { Volume2, Flame, RotateCcw, Sparkles } from 'lucide-react';
import { Rating, type Grade } from 'ts-fsrs';
import type { VocabCard } from '../types/vocab';
import { getIntervalLabels } from '../lib/fsrsEngine';
import { speakEnglish } from '../lib/tts';

interface FlashcardViewProps {
    card: VocabCard;
    currentIndex: number;
    totalCount: number;
    streak: number;
    onRate: (grade: Grade) => void;
}

export function FlashcardView({
                                  card,
                                  currentIndex,
                                  totalCount,
                                  streak,
                                  onRate,
                              }: FlashcardViewProps) {
    const [isFlipped, setIsFlipped] = useState(false);

    // 새 카드가 나올 때마다 앞면으로 초기화하고 단어 발음 자동 재생
    useEffect(() => {
        setIsFlipped(false);
        speakEnglish(card.word);
    }, [card]);

    const intervals = getIntervalLabels(card);

    const handleFlip = () => {
        setIsFlipped((prev) => !prev);
        if (!isFlipped) {
            speakEnglish(card.example, 0.85);
        }
    };

    return (
        <div className="flex flex-col h-full max-w-md mx-auto px-4 py-6 justify-between">
            {/* 상단 진행도 및 연속 정답 콤보 배지 */}
            <div className="space-y-3">
                <div className="flex items-center justify-between text-sm font-semibold">
          <span className="text-slate-500">
            오늘의 학습 <strong className="text-indigo-600">{currentIndex + 1}</strong> / {totalCount}
          </span>
                    <div className="flex items-center gap-1.5 bg-amber-100 text-amber-700 px-3 py-1 rounded-full">
                        <Flame className="w-4 h-4 fill-amber-500 text-amber-600" />
                        <span>{streak} 연속 정답!</span>
                    </div>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                        className="bg-indigo-600 h-full transition-all duration-300"
                        style={{ width: `${((currentIndex + 1) / totalCount) * 100}%` }}
                    />
                </div>
            </div>

            {/* 중앙 플래시카드 본체 */}
            <div
                onClick={handleFlip}
                className="my-6 flex-1 min-h-[320px] bg-white rounded-3xl shadow-lg border border-slate-100 p-6 flex flex-col justify-between cursor-pointer active:scale-[0.99] transition-transform"
            >
                <div className="flex justify-between items-center">
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600">
            {isFlipped ? '뜻 & 예문' : '영단어'}
          </span>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            speakEnglish(card.word);
                        }}
                        className="p-2.5 rounded-full bg-slate-100 hover:bg-indigo-100 text-indigo-600 transition-colors"
                        aria-label="단어 발음 듣기"
                    >
                        <Volume2 className="w-5 h-5" />
                    </button>
                </div>

                {/* 카드 내용 영역 */}
                <div className="text-center my-auto space-y-4">
                    <h2 className="text-4xl font-extrabold tracking-tight text-slate-800">
                        {card.word}
                    </h2>

                    {isFlipped ? (
                        <div className="pt-4 border-t border-slate-100 space-y-4 animate-fadeIn">
                            <p className="text-2xl font-bold text-indigo-600">{card.meaning}</p>

                            <div
                                onClick={(e) => {
                                    e.stopPropagation();
                                    speakEnglish(card.example, 0.85);
                                }}
                                className="bg-slate-50 rounded-2xl p-4 text-left space-y-1.5 border border-slate-200/70"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-base font-medium text-slate-800 leading-snug">
                                        "{card.example}"
                                    </p>
                                    <Volume2 className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                                </div>
                                <p className="text-sm text-slate-500">{card.exampleKo}</p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 pt-6 flex items-center justify-center gap-1.5">
                            <RotateCcw className="w-4 h-4" /> 카드를 터치해서 뜻 확인하기
                        </p>
                    )}
                </div>

                <div className="h-4" />
            </div>

            {/* 하단 FSRS 난이도 평가 4버튼 */}
            {isFlipped ? (
                <div className="grid grid-cols-4 gap-2">
                    <button
                        onClick={() => onRate(Rating.Again)}
                        className="flex flex-col items-center py-3 px-1 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 active:scale-95 transition"
                    >
                        <span className="font-bold text-sm">다시</span>
                        <span className="text-[11px] opacity-80 mt-0.5">{intervals[Rating.Again]}</span>
                    </button>

                    <button
                        onClick={() => onRate(Rating.Hard)}
                        className="flex flex-col items-center py-3 px-1 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 active:scale-95 transition"
                    >
                        <span className="font-bold text-sm">어려움</span>
                        <span className="text-[11px] opacity-80 mt-0.5">{intervals[Rating.Hard]}</span>
                    </button>

                    <button
                        onClick={() => onRate(Rating.Good)}
                        className="flex flex-col items-center py-3 px-1 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 active:scale-95 transition"
                    >
                        <span className="font-bold text-sm">알맞음</span>
                        <span className="text-[11px] opacity-80 mt-0.5">{intervals[Rating.Good]}</span>
                    </button>

                    <button
                        onClick={() => onRate(Rating.Easy)}
                        className="flex flex-col items-center py-3 px-1 rounded-2xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 active:scale-95 transition"
                    >
                        <span className="font-bold text-sm">쉬움</span>
                        <span className="text-[11px] opacity-80 mt-0.5">{intervals[Rating.Easy]}</span>
                    </button>
                </div>
            ) : (
                <button
                    onClick={handleFlip}
                    className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-base shadow-md shadow-indigo-200 active:scale-[0.98] transition flex items-center justify-center gap-2"
                >
                    <Sparkles className="w-5 h-5" /> 정답 확인하기
                </button>
            )}
        </div>
    );
}