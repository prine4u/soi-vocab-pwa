import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type FormEvent,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { fsrs, Rating, State, type Grade } from 'ts-fsrs';
import {
  Volume2,
  RotateCcw,
  Plus,
  List,
  BookOpen,
  Check,
  X,
  Sparkles,
  Search,
  Trash2,
  HelpCircle,
  Layers,
  Keyboard,
  Download,
  Upload,
  Pencil,
  Flame,
  Camera,
  Folder,
  FolderOpen,
  KeyRound,
  Loader2,
  CheckSquare,
  Square,
  RefreshCw,
  Server,
  Settings2,
  ChevronRight,
  ChevronDown,
  BarChart2,
  Smartphone,
  ArrowUp,
  ArrowDown,
  Star,
  Undo2,
  Zap,
  Shuffle,
  FileSpreadsheet,
  PlayCircle,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Puzzle,
} from 'lucide-react';
import type {
  VocabItem,
  StudyMode,
  StudyFilter,
  AppTab,
  StudyStats,
  ExtractedVocabDraft,
} from './types';
import {
  loadVocabItems,
  saveVocabItems,
  createNewVocabItem,
  createEmptyItemStats,
  loadStudyStats,
  saveStudyStats,
  recordAnswerStats,
  parseImportedVocab,
  getDateKey,
  formatDateTime,
  formatFolderSegment,
  normalizeCategory,
  loadCustomCategories,
  saveCustomCategories,
  extractEnglishOnly,
  getFirstSentence,
  cleanKoreanForTts,
  expandMeaningAbbreviations,
  getSpellingPromptMeaning,
  generateClozeData,
  loadLocalUpdatedAt,
  saveLocalUpdatedAt,
} from './utils/storage';
import {
  loadGeminiApiKey,
  saveGeminiApiKey,
  resizeImageToBase64,
  extractVocabFromImages,
} from './utils/ocr';
import {
  loadNasWebhookUrl,
  saveNasWebhookUrl,
  fetchNewNasVocab,
  clearNasRemoteDb,
  pushStateToNas,
} from './utils/cloudSync';
import { ExcelImportModal } from './components/ExcelImportModal';
import { FolderGuideModal } from './components/FolderGuideModal';
import { downloadSampleExcelFile } from './utils/excelImport';

interface CategoryTreeNode {
  name: string;
  fullPath: string;
  depth: number;
  children: CategoryTreeNode[];
}

function buildCategoryTree(allCategories: string[]): CategoryTreeNode[] {
  const rootMap = new Map<string, CategoryTreeNode>();

  allCategories.forEach((path) => {
    const segments = path.split('/').map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) return;

    let currentMap = rootMap;
    let currentPath = '';

    segments.forEach((seg, depth) => {
      currentPath = currentPath ? `${currentPath}/${seg}` : seg;
      if (!currentMap.has(seg)) {
        currentMap.set(seg, {
          name: seg,
          fullPath: currentPath,
          depth,
          children: [],
        });
      }
      const node = currentMap.get(seg)!;
      let childMap = (node as any)._childMap as Map<string, CategoryTreeNode> | undefined;
      if (!childMap) {
        childMap = new Map<string, CategoryTreeNode>();
        (node as any)._childMap = childMap;
      }
      currentMap = childMap;
    });
  });

  function mapToArray(map: Map<string, CategoryTreeNode>): CategoryTreeNode[] {
    const list: CategoryTreeNode[] = [];
    map.forEach((node) => {
      const childMap = (node as any)._childMap as Map<string, CategoryTreeNode> | undefined;
      delete (node as any)._childMap;
      node.children = childMap ? mapToArray(childMap) : [];
      list.push(node);
    });
    return list;
  }

  return mapToArray(rootMap);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UndoSnapshot {
  items: VocabItem[];
  stats: StudyStats;
  isCramMode: boolean;
  cramQueueIds: string[];
  wordLabel: string;
}

type FlashcardDirection = 'en-ko' | 'ko-en' | 'random';

const SPEECH_RATES = [0.5, 0.7, 0.8, 0.9, 1.0];
const SPEECH_RATE_STORAGE_KEY = 'soi_vocab_speech_rate_v1';
const FLASHCARD_DIR_STORAGE_KEY = 'soi_vocab_flashcard_dir_v1';
const AUTOPLAY_INTERVAL_STORAGE_KEY = 'soi_vocab_autoplay_interval_v1';
const AUTOPLAY_REPEAT_STORAGE_KEY = 'soi_vocab_autoplay_repeat_v1';
const AUTOPLAY_KOREAN_TTS_STORAGE_KEY = 'soi_vocab_autoplay_korean_tts_v1';
const STUDY_CATEGORY_STORAGE_KEY = 'soi_vocab_study_category_v1';
const LIST_CATEGORY_STORAGE_KEY = 'soi_vocab_list_category_v1';
const TARGET_CATEGORY_STORAGE_KEY = 'soi_vocab_target_category_v1';
const STUDY_MODE_STORAGE_KEY = 'soi_vocab_study_mode_v1';
const STUDY_FILTER_STORAGE_KEY = 'soi_vocab_study_filter_v1';
const COLLAPSED_FOLDERS_STORAGE_KEY = 'soi_vocab_collapsed_folders_v1';
const AUTOPLAY_INDEX_STORAGE_KEY = 'soi_vocab_autoplay_index_v1';
const AUTOPLAY_FOLDER_STORAGE_KEY = 'soi_vocab_autoplay_folder_v1';
const CRAM_MODE_STORAGE_KEY = 'soi_vocab_cram_mode_v1';
const CRAM_QUEUE_STORAGE_KEY = 'soi_vocab_cram_queue_v1';
const AUTO_PLAY_INTERVAL_OPTIONS = [
  1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20
];

function formatInterval(due: Date, now: Date): string {
  const diffMs = Math.max(0, due.getTime() - now.getTime());
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 1) return '1분 뒤';
  if (diffMin < 60) return `${diffMin}분 뒤`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}시간 뒤`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}일 뒤`;
  return `${Math.round(diffDays / 30)}개월 뒤`;
}

const DAILY_GOAL_STORAGE_KEY = 'soi_vocab_daily_goal';
const DAILY_NEW_LIMIT_STORAGE_KEY = 'soi_vocab_daily_new_limit';
const DAILY_NEW_STUDIED_KEY = 'soi_vocab_daily_new_studied';

function loadTodayNewStudiedCount(): number {
  const today = getDateKey();
  const raw = localStorage.getItem(DAILY_NEW_STUDIED_KEY);
  if (!raw) return 0;
  try {
    const data = JSON.parse(raw);
    if (data.date === today && typeof data.count === 'number') {
      return data.count;
    }
  } catch {}
  return 0;
}

function saveTodayNewStudiedCount(count: number): void {
  const today = getDateKey();
  localStorage.setItem(DAILY_NEW_STUDIED_KEY, JSON.stringify({ date: today, count }));
}

function getStateLabel(state: State): string {
  switch (state) {
    case State.New:
      return '새 단어';
    case State.Learning:
      return '학습 중';
    case State.Relearning:
      return '재학습';
    case State.Review:
      return '복습 단계';
    default:
      return '일반 학습 문제';
  }
}

function isCategoryMatch(itemTag: string | undefined, selectedFolder: string): boolean {
  if (selectedFolder === 'ALL') return true;
  const norm = normalizeCategory(itemTag);
  return norm === selectedFolder || norm.startsWith(`${selectedFolder}/`);
}

function isWeakItem(item: VocabItem): boolean {
  return (
      (item.card.lapses || 0) > 0 ||
      (item.itemStats?.losses || 0) >= 2 ||
      item.card.state === State.Relearning
  );
}

function resolveItemFolder(targetInput: string, detectedUnit?: string): string {
  const raw = targetInput.trim();
  const unitClean = detectedUnit ? formatFolderSegment(detectedUnit) : '';

  if (!raw) {
    return unitClean ? `Vocabulary Engine/${unitClean}` : 'Vocabulary Engine/Unit 01';
  }

  if (raw.includes('/')) {
    const parts = raw.split('/');
    const book = formatFolderSegment(parts[0]) || 'Vocabulary Engine';
    const rest = parts.slice(1).join('/').trim();
    if ((!rest || rest.includes(',')) && unitClean) {
      return `${book}/${unitClean}`;
    }
    const sub = formatFolderSegment(rest);
    return sub ? `${book}/${sub}` : book;
  }

  const formattedInput = formatFolderSegment(raw);
  if (unitClean && formattedInput.toLowerCase() !== unitClean.toLowerCase()) {
    return `${formattedInput}/${unitClean}`;
  }
  return formattedInput;
}

export function App() {
  const [items, setItems] = useState<VocabItem[]>(() => loadVocabItems());
  const [customCategories, setCustomCategories] = useState<string[]>(() =>
      loadCustomCategories()
  );
  const [stats, setStats] = useState<StudyStats>(() => loadStudyStats());
  const [activeTab, setActiveTab] = useState<AppTab>('study');
  const [studyMode, setStudyMode] = useState<StudyMode>(() => {
    const saved = localStorage.getItem(STUDY_MODE_STORAGE_KEY) as StudyMode | null;
    return saved === 'flashcard' || saved === 'spelling' || saved === 'autoplay' ? saved : 'flashcard';
  });
  const [flashcardDirection, setFlashcardDirection] = useState<FlashcardDirection>(() => {
    const saved = localStorage.getItem(FLASHCARD_DIR_STORAGE_KEY);
    return saved === 'ko-en' || saved === 'random' ? saved : 'en-ko';
  });
  const [randomSide, setRandomSide] = useState<'en-ko' | 'ko-en'>(() =>
    Math.random() < 0.5 ? 'en-ko' : 'ko-en'
  );
  const [studyFilter, setStudyFilter] = useState<StudyFilter>(() => {
    const saved = localStorage.getItem(STUDY_FILTER_STORAGE_KEY) as StudyFilter | null;
    return saved === 'all' || saved === 'starred' || saved === 'weak' ? saved : 'all';
  });
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [speechRate, setSpeechRate] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SPEECH_RATE_STORAGE_KEY));
    return SPEECH_RATES.includes(saved) ? saved : 0.9;
  });
  const speechRateRef = useRef<number>(speechRate);
  const speechTimeoutRef = useRef<number | null>(null);
  const cloudPushTimerRef = useRef<number | null>(null);

  // 안키 보조 기능: 자유 복습(벼락치기) 모드 및 실행 취소(Undo) 스택
  const [isCramMode, setIsCramMode] = useState<boolean>(() => {
    return localStorage.getItem(CRAM_MODE_STORAGE_KEY) === 'true';
  });
  const [cramQueueIds, setCramQueueIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CRAM_QUEUE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);

  const [showBottomStats, setShowBottomStats] = useState<boolean>(false);
  const [showFsrsModal, setShowFsrsModal] = useState<boolean>(false);  
  
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
      null
  );

  const [studyCategory, setStudyCategory] = useState<string>(() => {
    const saved = localStorage.getItem(STUDY_CATEGORY_STORAGE_KEY);
    return saved ? saved : 'ALL';
  });
  const [listCategory, setListCategory] = useState<string>(() => {
    const saved = localStorage.getItem(LIST_CATEGORY_STORAGE_KEY);
    return saved ? saved : 'ALL';
  });
  const [targetCategory, setTargetCategory] = useState<string>(() => {
    const saved = localStorage.getItem(TARGET_CATEGORY_STORAGE_KEY);
    if (saved) return saved;
    const savedStudy = localStorage.getItem(STUDY_CATEGORY_STORAGE_KEY);
    return savedStudy && savedStudy !== 'ALL' ? savedStudy : 'Vocabulary Engine';
  });
  const [showGgModal, setShowGgModal] = useState<boolean>(false);
  const [showFolderGuideModal, setShowFolderGuideModal] = useState<boolean>(false);
  const [newParentFolder, setNewParentFolder] = useState<string>('');
  const [newChildFolder, setNewChildFolder] = useState<string>('');

  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [typedAnswer, setTypedAnswer] = useState<string>('');
  const [spellingResult, setSpellingResult] = useState<'correct' | 'wrong' | null>(null);
  const [clozeInput, setClozeInput] = useState<string>('');
  const [clozeResult, setClozeResult] = useState<'correct' | 'wrong' | null>(null);
  const [showHint, setShowHint] = useState<boolean>(false);
  const cardStartTimeRef = useRef<number>(Date.now());
  const spellingInputRef = useRef<HTMLInputElement | null>(null);
  const clozeInputRef = useRef<HTMLInputElement | null>(null);

  // 자동 재생 (깜빡이 암기 모드) 상태 - 앱 실행 시에는 자동 음성 재생 방지를 위해 정지 상태로 시작
  const [isAutoPlayPlaying, setIsAutoPlayPlaying] = useState<boolean>(false);
  const [autoPlayInterval, setAutoPlayInterval] = useState<number>(() => {
    const saved = Number(localStorage.getItem(AUTOPLAY_INTERVAL_STORAGE_KEY));
    return AUTO_PLAY_INTERVAL_OPTIONS.includes(saved) ? saved : 2;
  });
  const [autoPlayRepeatCount, setAutoPlayRepeatCount] = useState<number>(() => {
    const saved = Number(localStorage.getItem(AUTOPLAY_REPEAT_STORAGE_KEY));
    return [1, 2, 3].includes(saved) ? saved : 1;
  });
  const [autoPlayKoreanTts, setAutoPlayKoreanTts] = useState<boolean>(() => {
    const saved = localStorage.getItem(AUTOPLAY_KOREAN_TTS_STORAGE_KEY);
    return saved !== null ? saved === 'true' : true;
  });
  const [showAutoPlayOptionsModal, setShowAutoPlayOptionsModal] = useState<boolean>(false);
  const [autoPlayIndex, setAutoPlayIndex] = useState<number>(() => {
    const savedFolder = localStorage.getItem(AUTOPLAY_FOLDER_STORAGE_KEY);
    const savedStudy = localStorage.getItem(STUDY_CATEGORY_STORAGE_KEY) || 'ALL';
    const savedIdx = Number(localStorage.getItem(AUTOPLAY_INDEX_STORAGE_KEY));
    if (savedFolder === savedStudy && Number.isFinite(savedIdx) && savedIdx >= 0) {
      return savedIdx;
    }
    return 0;
  });
  const [isAutoPlayLoop, setIsAutoPlayLoop] = useState<boolean>(true);
  const [autoPlayPhase, setAutoPlayPhase] = useState<'front' | 'back'>('front');
  const autoPlayTimerRef = useRef<number | null>(null);
  const autoPlaySpeechCancelledRef = useRef<boolean>(false);

  const handleUpdateAutoPlayInterval = (sec: number) => {
    setAutoPlayInterval(sec);
    localStorage.setItem(AUTOPLAY_INTERVAL_STORAGE_KEY, String(sec));
  };

  const handleUpdateAutoPlayRepeatCount = (cnt: number) => {
    setAutoPlayRepeatCount(cnt);
    localStorage.setItem(AUTOPLAY_REPEAT_STORAGE_KEY, String(cnt));
    showToast(`답 발음 반복: ${cnt}회로 설정되었습니다.`);
  };

  const handleToggleAutoPlayKoreanTts = () => {
    setAutoPlayKoreanTts((prev) => {
      const next = !prev;
      localStorage.setItem(AUTOPLAY_KOREAN_TTS_STORAGE_KEY, String(next));
      showToast(next ? '한글 음성 읽기(TTS) 켜짐' : '한글 음성 읽기(TTS) 꺼짐 (영어만)');
      return next;
    });
  };

  const [dailyGoal, setDailyGoal] = useState<number>(() => {
    const saved = Number(localStorage.getItem(DAILY_GOAL_STORAGE_KEY));
    return [20, 30, 50, 100].includes(saved) ? saved : 30;
  });

  const [dailyNewLimit, setDailyNewLimit] = useState<number>(() => {
    const raw = localStorage.getItem(DAILY_NEW_LIMIT_STORAGE_KEY);
    if (raw === null) return 20;
    const saved = Number(raw);
    return [0, 10, 20, 30, 50].includes(saved) ? saved : 20;
  });

  // OCR 오타 즉시 수정 인라인 모달 상태
  const [quickEditItem, setQuickEditItem] = useState<VocabItem | null>(null);
  const [quickEditWord, setQuickEditWord] = useState<string>('');
  const [quickEditMeaning, setQuickEditMeaning] = useState<string>('');
  const [quickEditPhonetic, setQuickEditPhonetic] = useState<string>('');
  const [quickEditExample, setQuickEditExample] = useState<string>('');

  const [todayNewStudiedCount, setTodayNewStudiedCount] = useState<number>(() => {
    return loadTodayNewStudiedCount();
  });

  const handleUpdateDailyGoal = (goal: number) => {
    setDailyGoal(goal);
    localStorage.setItem(DAILY_GOAL_STORAGE_KEY, String(goal));
    showToast(`🎯 일일 복습 목표: ${goal}개로 설정되었습니다.`);
  };

  const handleUpdateDailyNewLimit = (limit: number) => {
    setDailyNewLimit(limit);
    localStorage.setItem(DAILY_NEW_LIMIT_STORAGE_KEY, String(limit));
    showToast(
      limit === 0
        ? '⚡ 하루 새 단어 제한 해제 (전체 새 단어 학습)'
        : `⚡ 하루 새 단어 제한: ${limit}개로 설정되었습니다.`
    );
  };

  const [addSubTab, setAddSubTab] = useState<'camera' | 'single' | 'excel'>('camera');
  const [showExcelModal, setShowExcelModal] = useState<boolean>(false);
  const [newWord, setNewWord] = useState<string>('');
  const [newPhonetic, setNewPhonetic] = useState<string>('');
  const [newMeaning, setNewMeaning] = useState<string>('');
  const [newExample, setNewExample] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');

  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => loadGeminiApiKey());
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => loadGeminiApiKey());
  const [showApiKeyEditor, setShowApiKeyEditor] = useState<boolean>(
      () => !loadGeminiApiKey()
  );
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [ocrError, setOcrError] = useState<string>('');
  const [extractedDrafts, setExtractedDrafts] = useState<ExtractedVocabDraft[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [nasWebhookUrl, setNasWebhookUrl] = useState<string>(() => loadNasWebhookUrl());

  const [nasUrlInput, setNasUrlInput] = useState<string>(() => loadNasWebhookUrl());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWord, setEditWord] = useState<string>('');
  const [editPhonetic, setEditPhonetic] = useState<string>('');
  const [editMeaning, setEditMeaning] = useState<string>('');
  const [editExample, setEditExample] = useState<string>('');
  const [editTag, setEditTag] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const scheduler = useMemo(() => fsrs(), []);

  useEffect(() => {
    saveVocabItems(items);
  }, [items]);

  useEffect(() => {
    saveCustomCategories(customCategories);
  }, [customCategories]);

  useEffect(() => {
    saveStudyStats(stats);
  }, [stats]);

  useEffect(() => {
    speechRateRef.current = speechRate;
    localStorage.setItem(SPEECH_RATE_STORAGE_KEY, String(speechRate));
  }, [speechRate]);

  useEffect(() => {
    localStorage.setItem(FLASHCARD_DIR_STORAGE_KEY, flashcardDirection);
  }, [flashcardDirection]);

  useEffect(() => {
    localStorage.setItem(STUDY_CATEGORY_STORAGE_KEY, studyCategory);
  }, [studyCategory]);

  useEffect(() => {
    localStorage.setItem(LIST_CATEGORY_STORAGE_KEY, listCategory);
  }, [listCategory]);

  useEffect(() => {
    localStorage.setItem(TARGET_CATEGORY_STORAGE_KEY, targetCategory);
  }, [targetCategory]);

  useEffect(() => {
    localStorage.setItem(STUDY_MODE_STORAGE_KEY, studyMode);
  }, [studyMode]);

  useEffect(() => {
    localStorage.setItem(STUDY_FILTER_STORAGE_KEY, studyFilter);
  }, [studyFilter]);

  useEffect(() => {
    localStorage.setItem(CRAM_MODE_STORAGE_KEY, String(isCramMode));
    localStorage.setItem(CRAM_QUEUE_STORAGE_KEY, JSON.stringify(cramQueueIds));
  }, [isCramMode, cramQueueIds]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify(collapsedParents));
    } catch {}
  }, [collapsedParents]);

  useEffect(() => {
    localStorage.setItem(AUTOPLAY_INDEX_STORAGE_KEY, String(autoPlayIndex));
    localStorage.setItem(AUTOPLAY_FOLDER_STORAGE_KEY, studyCategory);
  }, [autoPlayIndex, studyCategory]);

  // 안전 폴백: 저장된 폴더가 완전히 삭제된 경우 'ALL'로 안전하게 복귀
  useEffect(() => {
    if (items.length > 0 && studyCategory !== 'ALL') {
      const exists =
        items.some((it) => isCategoryMatch(it.tag, studyCategory)) ||
        customCategories.some((cat) => isCategoryMatch(cat, studyCategory));
      if (!exists) {
        setStudyCategory('ALL');
      }
    }
  }, [items, customCategories, studyCategory]);

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3200);
  };

  const scheduleCloudPush = (
      nextItems: VocabItem[],
      nextCategories: string[],
      nextStats: StudyStats
  ) => {
    const updatedAt = saveLocalUpdatedAt(Date.now());
    if (!nasWebhookUrl.trim()) return;
    if (cloudPushTimerRef.current !== null) {
      window.clearTimeout(cloudPushTimerRef.current);
    }
    cloudPushTimerRef.current = window.setTimeout(() => {
      pushStateToNas(
          {
            updatedAt,
            items: nextItems,
            categories: nextCategories,
            stats: nextStats,
          },
          nasWebhookUrl
      ).catch(() => {});
    }, 500);
  };

  const allCategories = useMemo(() => {
    const ordered: string[] = [];
    customCategories.forEach((c) => {
      const norm = normalizeCategory(c);
      if (!ordered.includes(norm)) ordered.push(norm);
    });
    items.forEach((item) => {
      const norm = normalizeCategory(item.tag);
      if (!ordered.includes(norm)) ordered.push(norm);
    });
    return ordered;
  }, [customCategories, items]);

  const handleOpenQuickEdit = (item: VocabItem, e?: ReactMouseEvent) => {
    if (e) e.stopPropagation();
    setQuickEditItem(item);
    setQuickEditWord(item.word);
    setQuickEditMeaning(item.meaning);
    setQuickEditPhonetic(item.phonetic || '');
    setQuickEditExample(item.example || '');
  };

  const handleSaveQuickEdit = () => {
    if (!quickEditItem) return;
    const trimmedWord = quickEditWord.trim();
    const trimmedMeaning = quickEditMeaning.trim();
    if (!trimmedWord || !trimmedMeaning) {
      showToast('단어와 뜻을 입력해 주세요.');
      return;
    }
    const updatedItems = items.map((it) =>
      it.id === quickEditItem.id
        ? {
            ...it,
            word: trimmedWord,
            meaning: trimmedMeaning,
            phonetic: quickEditPhonetic.trim() || undefined,
            example: quickEditExample.trim() || undefined,
          }
        : it
    );
    setItems(updatedItems);
    saveVocabItems(updatedItems);
    scheduleCloudPush(updatedItems, allCategories, stats);
    showToast(`✏️ "${trimmedWord}" 단어 정보가 수정되었습니다.`);
    setQuickEditItem(null);
  };

  const categoryTree = useMemo<CategoryTreeNode[]>(() => {
    return buildCategoryTree(allCategories);
  }, [allCategories]);

  const getFolderCounts = (folderPath: string) => {
    const nowMs = new Date().setHours(23, 59, 59, 999);
    let due = 0;
    let total = 0;
    items.forEach((item) => {
      if (isCategoryMatch(item.tag, folderPath)) {
        total += 1;
        if (item.card.due.getTime() <= nowMs) due += 1;
      }
    });
    return { due, total };
  };

  const selectedPoolItems = useMemo(() => {
    return items.filter((item) => isCategoryMatch(item.tag, studyCategory));
  }, [items, studyCategory]);

  const starredCount = useMemo(
      () => selectedPoolItems.filter((item) => item.starred).length,
      [selectedPoolItems]
  );

  const weakCount = useMemo(
      () => selectedPoolItems.filter((item) => isWeakItem(item)).length,
      [selectedPoolItems]
  );

  const filteredPoolItems = useMemo(() => {
    if (studyFilter === 'starred') {
      return selectedPoolItems.filter((item) => item.starred);
    }
    if (studyFilter === 'weak') {
      return selectedPoolItems.filter((item) => isWeakItem(item));
    }
    return selectedPoolItems;
  }, [selectedPoolItems, studyFilter]);

  const selectionMetrics = useMemo(() => {
    let totalTries = 0;
    let totalTimeMs = 0;
    selectedPoolItems.forEach((item) => {
      const w = item.itemStats?.wins || 0;
      const l = item.itemStats?.losses || 0;
      totalTries += w + l;
      totalTimeMs += item.itemStats?.totalTimeMs || 0;
    });
    const avgSec = totalTries > 0 ? (totalTimeMs / totalTries / 1000).toFixed(2) : '0.00';
    return { totalTries, avgSec };
  }, [selectedPoolItems]);

  const totalDueInPool = useMemo(() => {
    const endOfToday = new Date().setHours(23, 59, 59, 999);
    return filteredPoolItems.filter((item) => item.card.due.getTime() <= endOfToday).length;
  }, [filteredPoolItems]);

  // 일반 FSRS 복습 대기열 vs 자유 복습(벼락치기) 대기열
  const dueItems = useMemo(() => {
    if (isCramMode) {
      const itemMap = new Map(filteredPoolItems.map((it) => [it.id, it]));
      return cramQueueIds
          .map((id) => itemMap.get(id))
          .filter((it): it is VocabItem => !!it);
    }

    const endOfToday = new Date().setHours(23, 59, 59, 999);

    // 1. 기존 복습 대기 단어 (Learning, Review, Relearning)
    const reviewDueList = filteredPoolItems.filter(
      (item) => item.card.state !== State.New && item.card.due.getTime() <= endOfToday
    );

    // 2. 새 단어 (State.New)
    const newCandidateList = filteredPoolItems.filter(
      (item) => item.card.state === State.New
    );

    // 오늘 배울 수 있는 남은 새 단어 할당량
    const remainingNewQuota = dailyNewLimit === 0
      ? newCandidateList.length
      : Math.max(0, dailyNewLimit - todayNewStudiedCount);

    const allowedNewList = newCandidateList.slice(0, remainingNewQuota);
    const combined = [...reviewDueList, ...allowedNewList];

    return combined.sort((a, b) => {
      // 복습 단어를 새 단어보다 먼저 배치
      const aIsNew = a.card.state === State.New ? 1 : 0;
      const bIsNew = b.card.state === State.New ? 1 : 0;
      if (aIsNew !== bIsNew) {
        return aIsNew - bIsNew;
      }
      const aLast = a.itemStats?.lastSolvedAt || 0;
      const bLast = b.itemStats?.lastSolvedAt || 0;
      if (aLast !== bLast) {
        return aLast - bLast;
      }
      return a.card.due.getTime() - b.card.due.getTime();
    });
  }, [filteredPoolItems, isCramMode, cramQueueIds, dailyNewLimit, todayNewStudiedCount]);

  const autoPlayPool = useMemo(() => {
    if (isCramMode && cramQueueIds.length > 0) {
      const itemMap = new Map(filteredPoolItems.map((it) => [it.id, it]));
      return cramQueueIds
          .map((id) => itemMap.get(id))
          .filter((it): it is VocabItem => !!it);
    }
    if (dueItems.length > 0) {
      return dueItems;
    }
    return filteredPoolItems;
  }, [isCramMode, cramQueueIds, filteredPoolItems, dueItems]);

  const autoPlayCurrentItem = autoPlayPool[autoPlayIndex] ?? null;
  const currentItem = studyMode === 'autoplay' ? autoPlayCurrentItem : (dueItems[0] ?? null);

  useEffect(() => {
    if (studyMode === 'autoplay' && autoPlayIndex >= autoPlayPool.length && autoPlayPool.length > 0) {
      setAutoPlayIndex(0);
    }
  }, [studyMode, autoPlayIndex, autoPlayPool.length]);
  const effectiveDirection: 'en-ko' | 'ko-en' =
    flashcardDirection === 'random' ? randomSide : flashcardDirection;
  const isKoToEn = effectiveDirection === 'ko-en';

  const currentClozeData = useMemo(() => {
    if (!currentItem) return null;
    return generateClozeData(currentItem.word, currentItem.meaning, currentItem.example);
  }, [currentItem?.id, currentItem?.word, currentItem?.meaning, currentItem?.example]);

  useEffect(() => {
    cardStartTimeRef.current = Date.now();
  }, [currentItem?.id, studyCategory]);

  const speakWord = (text: string, customRate?: number) => {
    if (!('speechSynthesis' in window) || !text.trim()) return;

    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
    }
    window.speechSynthesis.cancel();

    const rawRate = customRate ?? speechRateRef.current ?? speechRate;
    const targetRate = Number(Math.min(2.0, Math.max(0.4, rawRate)).toFixed(2));
    const cleanText = text.trim();

    speechTimeoutRef.current = window.setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      const enVoice =
          voices.find((v) => (v.lang === 'en-US' || v.lang === 'en_US') && v.localService) ||
          voices.find((v) => v.lang.startsWith('en') && v.localService) ||
          voices.find((v) => v.lang === 'en-US' || v.lang === 'en_US') ||
          voices.find((v) => v.lang.startsWith('en'));

      const chunks = cleanText
          .split(/(?<=[.?!])\s+/)
          .map((s) => s.trim())
          .filter(Boolean);

      const list = chunks.length > 0 ? chunks : [cleanText];

      list.forEach((sentence) => {
        const utterance = new SpeechSynthesisUtterance(sentence);
        if (enVoice) {
          utterance.voice = enVoice;
        }
        utterance.lang = 'en-US';
        utterance.rate = targetRate;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      });
    }, 80);
  };

  const speakExampleOrWord = (item: VocabItem, customRate?: number) => {
    const rateToUse = customRate ?? speechRateRef.current ?? speechRate;
    const engExample = extractEnglishOnly(item.example);
    if (engExample) {
      speakWord(engExample, rateToUse);
    } else {
      speakWord(item.word, rateToUse);
    }
  };

  const speakKorean = (text: string, customRate?: number) => {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
    }
    window.speechSynthesis.cancel();

    const cleanText = text.trim();
    speechTimeoutRef.current = window.setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      const koVoice =
        voices.find((v) => (v.lang === 'ko-KR' || v.lang === 'ko_KR') && v.localService) ||
        voices.find((v) => v.lang.startsWith('ko') && v.localService) ||
        voices.find((v) => v.lang === 'ko-KR' || v.lang === 'ko_KR') ||
        voices.find((v) => v.lang.startsWith('ko'));

      const utterance = new SpeechSynthesisUtterance(cleanText);
      if (koVoice) utterance.voice = koVoice;
      utterance.lang = 'ko-KR';
      utterance.rate = customRate ?? 0.95;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }, 60);
  };

  const playSpeechQueue = (
    queue: Array<{ text: string; lang: 'en-US' | 'ko-KR'; rate?: number; delayAfterMs?: number }>,
    onComplete: () => void
  ) => {
    if (!('speechSynthesis' in window) || queue.length === 0) {
      onComplete();
      return;
    }

    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    window.speechSynthesis.cancel();
    autoPlaySpeechCancelledRef.current = false;

    let index = 0;
    const voices = window.speechSynthesis.getVoices();
    const enVoice =
      voices.find((v) => (v.lang === 'en-US' || v.lang === 'en_US') && v.localService) ||
      voices.find((v) => v.lang.startsWith('en') && v.localService) ||
      voices.find((v) => v.lang === 'en-US' || v.lang === 'en_US') ||
      voices.find((v) => v.lang.startsWith('en'));

    const koVoice =
      voices.find((v) => (v.lang === 'ko-KR' || v.lang === 'ko_KR') && v.localService) ||
      voices.find((v) => v.lang.startsWith('ko') && v.localService) ||
      voices.find((v) => v.lang === 'ko-KR' || v.lang === 'ko_KR') ||
      voices.find((v) => v.lang.startsWith('ko'));

    let timerId: number | null = null;

    const playNext = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      if (autoPlaySpeechCancelledRef.current) return;
      if (index >= queue.length) {
        onComplete();
        return;
      }

      const item = queue[index++];
      const cleanText = item.text.trim();
      if (!cleanText) {
        playNext();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      if (item.lang === 'ko-KR') {
        utterance.lang = 'ko-KR';
        if (koVoice) utterance.voice = koVoice;
        utterance.rate = 0.95;
      } else {
        utterance.lang = 'en-US';
        if (enVoice) utterance.voice = enVoice;
        utterance.rate = item.rate ?? speechRate;
      }

      let stepDone = false;
      const finishStep = () => {
        if (stepDone) return;
        stepDone = true;
        if (timerId !== null) {
          window.clearTimeout(timerId);
          timerId = null;
        }

        if (autoPlaySpeechCancelledRef.current) return;

        // 마지막 발음 항목이 끝난 것이라면 추가 대기 없이 즉시 완료 콜백 호출
        if (index >= queue.length) {
          onComplete();
          return;
        }

        // 반복 발음 사이에는 사용자가 편안하게 따라 읽을 수 있도록 1초(1000ms) 텀을 두고 다음 발음 진행
        const delayMs = item.delayAfterMs ?? 1000;
        speechTimeoutRef.current = window.setTimeout(() => {
          if (!autoPlaySpeechCancelledRef.current) {
            playNext();
          }
        }, delayMs);
      };

      utterance.onend = finishStep;
      utterance.onerror = finishStep;

      const maxWait = Math.max(1600, Math.round((cleanText.length / 5) * 1000) + 2000);
      timerId = window.setTimeout(finishStep, maxWait);

      window.speechSynthesis.speak(utterance);
    };

    speechTimeoutRef.current = window.setTimeout(playNext, 60);
  };

  useEffect(() => {
    if (activeTab !== 'study' || studyMode !== 'flashcard' || !autoSpeak || !currentItem) {
      return;
    }
    if (isKoToEn) {
      // 한→영 모드: 앞면(한국어 뜻)에서는 발음을 숨기고, 카드를 뒤집어 영어 정답이 공개될 때 발음 재생
      if (isFlipped) {
        speakWord(currentItem.word, speechRate);
      }
    } else {
      // 영→한 모드: 앞면에서는 영단어 발음, 뒷면에서는 예문 발음 재생
      if (!isFlipped) {
        speakWord(currentItem.word, speechRate);
      } else {
        speakExampleOrWord(currentItem, speechRate);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, studyMode, autoSpeak, currentItem?.id, isFlipped, effectiveDirection]);

  useEffect(() => {
    if (activeTab === 'study' && studyMode === 'spelling' && currentItem && !spellingResult) {
      spellingInputRef.current?.focus();
    }
  }, [activeTab, studyMode, currentItem?.id, spellingResult]);

  useEffect(() => {
    if (activeTab === 'study' && studyMode === 'cloze' && currentItem && !isFlipped) {
      clozeInputRef.current?.focus();
    }
  }, [activeTab, studyMode, currentItem?.id, isFlipped]);

  const resetCardInteraction = () => {
    setIsFlipped(false);
    setTypedAnswer('');
    setSpellingResult(null);
    setClozeInput('');
    setClozeResult(null);
    setShowHint(false);
    setAutoPlayPhase('front');
    setRandomSide(Math.random() < 0.5 ? 'en-ko' : 'ko-en');
    cardStartTimeRef.current = Date.now();
  };

  const handleToggleFlashcardDirection = () => {
    setFlashcardDirection((prev) => {
      const next: FlashcardDirection = prev === 'en-ko' ? 'ko-en' : prev === 'ko-en' ? 'random' : 'en-ko';
      return next;
    });
    resetCardInteraction();
  };

  // 자동 재생 (깜빡이 암기 모드) 시작, 종료, 이동
  const startAutoPlay = () => {
    if (autoPlayPool.length === 0) {
      showToast('학습할 단어가 없습니다.');
      return;
    }
    setStudyMode('autoplay');
    setIsAutoPlayPlaying(true);
    setAutoPlayPhase('front');
    setIsFlipped(false);
    setAutoPlayIndex(0);
    autoPlaySpeechCancelledRef.current = false;
  };

  const exitAutoPlay = () => {
    setStudyMode('flashcard');
    setIsAutoPlayPlaying(false);
    autoPlaySpeechCancelledRef.current = true;
    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (autoPlayTimerRef.current !== null) {
      window.clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    window.speechSynthesis?.cancel();
    resetCardInteraction();
  };

  const handleAutoplayStep = (direction: 'prev' | 'next') => {
    autoPlaySpeechCancelledRef.current = true;
    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (autoPlayTimerRef.current !== null) {
      window.clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    window.speechSynthesis?.cancel();

    if (direction === 'next') {
      if (autoPlayIndex + 1 < autoPlayPool.length) {
        setAutoPlayIndex((prev) => prev + 1);
      } else if (isAutoPlayLoop && autoPlayPool.length > 0) {
        setAutoPlayIndex(0);
      }
    } else {
      if (autoPlayIndex > 0) {
        setAutoPlayIndex((prev) => prev - 1);
      } else if (isAutoPlayLoop && autoPlayPool.length > 0) {
        setAutoPlayIndex(Math.max(0, autoPlayPool.length - 1));
      }
    }
    setAutoPlayPhase('front');
    setIsFlipped(false);
  };

  // 자동 재생 (깜빡이 모드) 타이머 및 발음 실행 루프
  useEffect(() => {
    if (activeTab !== 'study' || studyMode !== 'autoplay' || !isAutoPlayPlaying || !autoPlayCurrentItem) {
      autoPlaySpeechCancelledRef.current = true;
      if (speechTimeoutRef.current !== null) {
        window.clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }
      if (autoPlayTimerRef.current !== null) {
        window.clearTimeout(autoPlayTimerRef.current);
        autoPlayTimerRef.current = null;
      }
      window.speechSynthesis?.cancel();
      return;
    }

    // 1단계: 앞면 (문제 보여주기 + 발음 -> 설정 초 뒤 정답 화면 전환)
    if (autoPlayPhase === 'front') {
      setIsFlipped(false);
      autoPlaySpeechCancelledRef.current = false;

      if (!isKoToEn) {
        // 영->한 모드: 앞면에 영어 단어가 보이므로 첫 번째 단어/문장 발음
        const firstEng = getFirstSentence(autoPlayCurrentItem.word);
        if (firstEng) {
          speakWord(firstEng, speechRate);
        }
      } else {
        // 한->영 모드: 앞면에 한국어 뜻이 보이므로, 한글 TTS가 켜져 있으면 한국어 첫 문장 읽기
        if (autoPlayKoreanTts) {
          const cleanKo = cleanKoreanForTts(autoPlayCurrentItem.meaning);
          const firstKo = getFirstSentence(cleanKo);
          if (firstKo) {
            speakKorean(firstKo);
          }
        }
      }

      const ms = Math.round(autoPlayInterval * 1000);
      autoPlayTimerRef.current = window.setTimeout(() => {
        setIsFlipped(true);
        setAutoPlayPhase('back');
      }, ms);

      return () => {
        autoPlaySpeechCancelledRef.current = true;
        if (speechTimeoutRef.current !== null) {
          window.clearTimeout(speechTimeoutRef.current);
          speechTimeoutRef.current = null;
        }
        if (autoPlayTimerRef.current !== null) {
          window.clearTimeout(autoPlayTimerRef.current);
          autoPlayTimerRef.current = null;
        }
      };
    }

    // 2단계: 뒷면 (정답 TTS 첫 문장/단어 읽기 -> TTS 완료 즉시 다음 문제로 이동)
    if (autoPlayPhase === 'back') {
      setIsFlipped(true);
      autoPlaySpeechCancelledRef.current = false;

      const queue: Array<{ text: string; lang: 'en-US' | 'ko-KR'; rate?: number }> = [];
      const cleanKo = cleanKoreanForTts(autoPlayCurrentItem.meaning);
      const firstKoSentence = getFirstSentence(cleanKo);

      // 영어 정답: 첫 번째 문장/단어만 깔끔하게 추출
      const engExample = extractEnglishOnly(autoPlayCurrentItem.example);
      const rawEngAnswer = isKoToEn
          ? (autoPlayCurrentItem.word || engExample)
          : (autoPlayCurrentItem.word || engExample);
      const firstEngSentence = getFirstSentence(rawEngAnswer);

      if (!isKoToEn) {
        // 영->한 모드: 정답은 한국어 뜻(첫 문장/단어) + 영어 정답(첫 문장/단어)
        if (autoPlayKoreanTts && firstKoSentence) {
          queue.push({ text: firstKoSentence, lang: 'ko-KR' });
        }
        // 영어 발음 (반복 횟수 autoPlayRepeatCount 적용: 1회, 2회, 3회)
        for (let i = 0; i < autoPlayRepeatCount; i++) {
          if (firstEngSentence) {
            queue.push({ text: firstEngSentence, lang: 'en-US', rate: speechRate });
          }
        }
      } else {
        // 한->영 모드: 앞면에서 이미 한글 문제를 보았으므로, 뒷면(정답)에서는 영어 정답만 지정한 횟수만큼 읽고 한글을 다시 읽지 않습니다.
        for (let i = 0; i < autoPlayRepeatCount; i++) {
          if (firstEngSentence) {
            queue.push({ text: firstEngSentence, lang: 'en-US', rate: speechRate });
          }
        }
      }

      playSpeechQueue(queue, () => {
        // 답 TTS를 다 읽으면 1초 대기 없이 즉시 다음 문제로 진행!
        autoPlayTimerRef.current = window.setTimeout(() => {
          if (autoPlayIndex + 1 < autoPlayPool.length) {
            setAutoPlayIndex((prev) => prev + 1);
            setAutoPlayPhase('front');
            setIsFlipped(false);
          } else if (isAutoPlayLoop && autoPlayPool.length > 0) {
            setAutoPlayIndex(0);
            setAutoPlayPhase('front');
            setIsFlipped(false);
            showToast('🔁 1회독 완료! 처음부터 반복 재생합니다.');
          } else {
            setIsAutoPlayPlaying(false);
            showToast('🎉 모든 단어 깜빡이 암기를 마쳤습니다!');
          }
        }, 60);
      });

      return () => {
        autoPlaySpeechCancelledRef.current = true;
        if (speechTimeoutRef.current !== null) {
          window.clearTimeout(speechTimeoutRef.current);
          speechTimeoutRef.current = null;
        }
        if (autoPlayTimerRef.current !== null) {
          window.clearTimeout(autoPlayTimerRef.current);
          autoPlayTimerRef.current = null;
        }
        window.speechSynthesis?.cancel();
      };
    }
  }, [
    activeTab,
    studyMode,
    isAutoPlayPlaying,
    autoPlayPhase,
    autoPlayIndex,
    autoPlayCurrentItem?.id,
    autoPlayInterval,
    autoPlayRepeatCount,
    autoPlayKoreanTts,
    isAutoPlayLoop,
    isKoToEn,
    speechRate,
    autoPlayPool.length,
  ]);

  // 안키 보조 기능 1: 자유 복습(벼락치기) 시작 및 종료
  const startCramMode = (overrideFilter?: StudyFilter) => {
    const targetFilter = overrideFilter ?? studyFilter;
    let pool = selectedPoolItems;
    if (targetFilter === 'starred') {
      pool = selectedPoolItems.filter((item) => item.starred);
    } else if (targetFilter === 'weak') {
      pool = selectedPoolItems.filter((item) => isWeakItem(item));
    }

    if (pool.length === 0) {
      showToast('해당 조건에 복습할 단어가 없습니다.');
      return;
    }

    if (overrideFilter && overrideFilter !== studyFilter) {
      setStudyFilter(overrideFilter);
    }
    setIsCramMode(true);
    setCramQueueIds(pool.map((item) => item.id));
    resetCardInteraction();
    showToast(
        `⚡ 자유 복습(벼락치기) 시작! FSRS 일정 변경 없이 ${pool.length}단어를 테스트합니다.`
    );
  };

  const exitCramMode = () => {
    setIsCramMode(false);
    setCramQueueIds([]);
    resetCardInteraction();
    showToast('일반 FSRS 복습 모드로 돌아왔습니다.');
  };

  // 안키 보조 기능 2: 별표(⭐) 북마크 토글
  const handleToggleStar = (itemId: string, e?: ReactMouseEvent) => {
    if (e) e.stopPropagation();
    let targetWord = '';
    let nextStarred = false;

    const nextItems = items.map((item) => {
      if (item.id !== itemId) return item;
      targetWord = item.word;
      nextStarred = !item.starred;
      return { ...item, starred: nextStarred };
    });

    setItems(nextItems);
    scheduleCloudPush(nextItems, allCategories, stats);
    if (targetWord) {
      showToast(
          nextStarred
              ? `⭐ "${targetWord}" 단어를 별표 단어장에 추가했습니다.`
              : `"${targetWord}" 단어의 별표를 해제했습니다.`
      );
    }
  };

  // 안키 보조 기능 3: 직전 카드 평가 되돌리기 (Undo)
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const lastSnap = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setItems(lastSnap.items);
    setStats(lastSnap.stats);
    setIsCramMode(lastSnap.isCramMode);
    setCramQueueIds(lastSnap.cramQueueIds);
    if (lastSnap.wordLabel) {
      const target = items.find((it) => it.word === lastSnap.wordLabel);
      if (target && target.card.state === State.New) {
        setTodayNewStudiedCount((prev) => {
          const next = Math.max(0, prev - 1);
          saveTodayNewStudiedCount(next);
          return next;
        });
      }
    }
    resetCardInteraction();
    scheduleCloudPush(lastSnap.items, allCategories, lastSnap.stats);
    showToast(`↩️ "${lastSnap.wordLabel}" 카드로 되돌렸습니다.`);
  };

  const handleMoveTreeNode = (fullPath: string, direction: 'up' | 'down') => {
    const segments = fullPath.split('/');
    const nodeName = segments[segments.length - 1];
    const parentPrefix = segments.slice(0, -1).join('/');

    const uniqueChildSegments: string[] = [];
    allCategories.forEach((cat) => {
      if (parentPrefix) {
        if (cat === parentPrefix || cat.startsWith(`${parentPrefix}/`)) {
          const sub = cat.slice(parentPrefix.length + 1);
          const firstSeg = sub.split('/')[0];
          if (firstSeg && !uniqueChildSegments.includes(firstSeg)) {
            uniqueChildSegments.push(firstSeg);
          }
        }
      } else {
        const firstSeg = cat.split('/')[0];
        if (firstSeg && !uniqueChildSegments.includes(firstSeg)) {
          uniqueChildSegments.push(firstSeg);
        }
      }
    });

    const cIdx = uniqueChildSegments.indexOf(nodeName);
    if (cIdx < 0) return;
    const swapIdx = direction === 'up' ? cIdx - 1 : cIdx + 1;
    if (swapIdx < 0 || swapIdx >= uniqueChildSegments.length) return;

    const temp = uniqueChildSegments[cIdx];
    uniqueChildSegments[cIdx] = uniqueChildSegments[swapIdx];
    uniqueChildSegments[swapIdx] = temp;

    const nextCategories: string[] = [];
    uniqueChildSegments.forEach((seg) => {
      const targetPrefix = parentPrefix ? `${parentPrefix}/${seg}` : seg;
      allCategories.forEach((cat) => {
        if (cat === targetPrefix || cat.startsWith(`${targetPrefix}/`)) {
          if (!nextCategories.includes(cat)) {
            nextCategories.push(cat);
          }
        }
      });
    });

    allCategories.forEach((cat) => {
      if (!nextCategories.includes(cat)) {
        nextCategories.push(cat);
      }
    });

    setCustomCategories(nextCategories);
    scheduleCloudPush(items, nextCategories, stats);
  };

  const handleCollapseAll = () => {
    const allCollapsed: Record<string, boolean> = {};
    const traverse = (nodes: CategoryTreeNode[]) => {
      nodes.forEach((n) => {
        if (n.children.length > 0) {
          allCollapsed[n.fullPath] = true;
          traverse(n.children);
        }
      });
    };
    traverse(categoryTree);
    setCollapsedParents(allCollapsed);
  };

  const handleExpandAll = () => {
    setCollapsedParents({});
  };

  const handleAddFolderHierarchy = () => {
    const rawCombined = [newParentFolder.trim(), newChildFolder.trim()].filter(Boolean).join('/');
    if (!rawCombined) return;
    const fullPath = normalizeCategory(rawCombined);
    const nextCats = Array.from(new Set([...allCategories, fullPath]));
    setCustomCategories(nextCats);
    setTargetCategory(fullPath);
    setStudyCategory(fullPath);
    setNewParentFolder('');
    setNewChildFolder('');
    scheduleCloudPush(items, nextCats, stats);
    showToast(`📁 [${fullPath}] 폴더가 생성되었습니다.`);
  };

  const handleQuickAddSubfolder = (parentName: string) => {
    const sub = window.prompt(
        `[${parentName}] 아래에 만들 하위 폴더(권/강/단원) 이름을 입력하세요:`,
        '01강'
    );
    if (!sub || !sub.trim()) return;
    const fullPath = normalizeCategory(`${parentName}/${sub.trim()}`);
    const nextCats = Array.from(new Set([...allCategories, fullPath]));
    setCustomCategories(nextCats);
    setStudyCategory(fullPath);
    setTargetCategory(fullPath);
    scheduleCloudPush(items, nextCats, stats);
    showToast(`📁 [${fullPath}] 하위 폴더가 추가되었습니다.`);
  };

  const handleRenameFolder = (oldPath: string) => {
    const nextName = window.prompt(
        `폴더 이름 또는 경로를 변경합니다 ("상위폴더/하위폴더" 형식으로 다른 폴더 밑으로 이동 가능):`,
        oldPath
    );
    if (!nextName || !nextName.trim() || nextName.trim() === oldPath) return;
    const cleaned = normalizeCategory(nextName);

    const nextItems = items.map((item) => {
      const norm = normalizeCategory(item.tag);
      if (norm === oldPath) return { ...item, tag: cleaned };
      if (norm.startsWith(`${oldPath}/`)) {
        return {
          ...item,
          tag: normalizeCategory(`${cleaned}/${norm.slice(oldPath.length + 1)}`),
        };
      }
      return item;
    });

    const nextCats = allCategories.map((cat) => {
      if (cat === oldPath) return cleaned;
      if (cat.startsWith(`${oldPath}/`)) {
        return normalizeCategory(`${cleaned}/${cat.slice(oldPath.length + 1)}`);
      }
      return cat;
    });

    setItems(nextItems);
    setCustomCategories(nextCats);
    if (studyCategory === oldPath) setStudyCategory(cleaned);
    if (listCategory === oldPath) setListCategory(cleaned);
    if (targetCategory === oldPath) setTargetCategory(cleaned);
    scheduleCloudPush(nextItems, nextCats, stats);
    showToast(`✏️ [${oldPath}] → [${cleaned}] 변경 완료`);
  };

  const handleDeleteCategory = (folderPath: string) => {
    const { total } = getFolderCounts(folderPath);
    const msg =
        total > 0
            ? `[${folderPath}] 폴더(하위 유닛 포함)와 단어 ${total}개를 모두 삭제하시겠습니까?`
            : `[${folderPath}] 빈 폴더를 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;

    const nextItems = items.filter((item) => !isCategoryMatch(item.tag, folderPath));
    const nextCats = allCategories.filter(
        (c) => c !== folderPath && !c.startsWith(`${folderPath}/`)
    );
    setItems(nextItems);
    setCustomCategories(nextCats);
    if (isCategoryMatch(studyCategory, folderPath)) setStudyCategory('ALL');
    if (isCategoryMatch(listCategory, folderPath)) setListCategory('ALL');
    scheduleCloudPush(nextItems, nextCats, stats);
    showToast(`🗑️ [${folderPath}] 폴더가 삭제되었습니다.`);
  };

  const renderCategoryNode = (
      node: CategoryTreeNode,
      isModal: boolean,
      siblings: CategoryTreeNode[],
      sIdx: number
  ): React.ReactNode => {
    const counts = getFolderCounts(node.fullPath);
    const isSelected = isModal ? studyCategory === node.fullPath : listCategory === node.fullPath;
    const isCollapsed = !!collapsedParents[node.fullPath];
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.fullPath} className={`tree-node-wrap depth-${node.depth}`}>
        <div className="folder-item-wrap">
          {hasChildren ? (
            <button
                type="button"
                className="folder-expand-btn"
                onClick={() =>
                    setCollapsedParents((prev) => ({
                      ...prev,
                      [node.fullPath]: !prev[node.fullPath],
                    }))
                }
                title={isCollapsed ? '하위 폴더 펼치기' : '하위 폴더 접기'}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span style={{ width: 17, display: 'inline-block' }} />
          )}

          <button
              type="button"
              className={`folder-item ${isSelected ? 'active' : ''}`}
              onClick={() => {
                if (isModal) {
                  setStudyCategory(node.fullPath);
                  setTargetCategory(node.fullPath);
                  setIsCramMode(false);
                  setAutoPlayIndex(0);
                  resetCardInteraction();
                  setShowGgModal(false);
                } else {
                  setListCategory(node.fullPath);
                }
              }}
          >
            <span className="folder-item-left">
              {node.depth === 0 ? (
                isSelected || !isCollapsed ? <FolderOpen size={15} /> : <Folder size={15} />
              ) : hasChildren ? (
                isSelected || !isCollapsed ? <FolderOpen size={14} /> : <Folder size={14} />
              ) : (
                <Folder size={13} />
              )}
              <span className="folder-name">
                {node.depth === 0 ? `★ ${node.name}` : node.name}
              </span>
            </span>
            <span className="folder-count">
              {isModal ? `${counts.due}/${counts.total}` : `${counts.total}단어`}
            </span>
          </button>

          <button
              type="button"
              className="folder-action-btn"
              title="위로 이동"
              disabled={sIdx === 0}
              onClick={() => handleMoveTreeNode(node.fullPath, 'up')}
          >
            <ArrowUp size={12} />
          </button>
          <button
              type="button"
              className="folder-action-btn"
              title="아래로 이동"
              disabled={sIdx === siblings.length - 1}
              onClick={() => handleMoveTreeNode(node.fullPath, 'down')}
          >
            <ArrowDown size={12} />
          </button>
          <button
              type="button"
              className="folder-action-btn"
              title="하위 단원/유닛 추가"
              onClick={() => handleQuickAddSubfolder(node.fullPath)}
          >
            <Plus size={12} />
          </button>
          <button
              type="button"
              className="folder-action-btn"
              title="폴더 이름/경로 변경"
              onClick={() => handleRenameFolder(node.fullPath)}
          >
            <Pencil size={12} />
          </button>
          <button
              type="button"
              className="folder-action-btn danger"
              title="폴더 삭제"
              onClick={() => handleDeleteCategory(node.fullPath)}
          >
            <Trash2 size={12} />
          </button>
        </div>

        {!isCollapsed && hasChildren && (
          <div className="tree-children-container">
            {node.children.map((child, cIdx) =>
              renderCategoryNode(child, isModal, node.children, cIdx)
            )}
          </div>
        )}
      </div>
    );
  };

  const handleResetFolderStats = () => {
    const label = studyCategory === 'ALL' ? '전체 단어장' : studyCategory;
    if (!window.confirm(`[${label}]의 학습 기록과 FSRS 복습 일정을 처음 상태로 초기화하시겠습니까?`)) {
      return;
    }
    const nowDate = new Date();
    const nextItems = items.map((item) => {
      if (!isCategoryMatch(item.tag, studyCategory)) return item;
      return {
        ...item,
        itemStats: createEmptyItemStats(),
        card: createNewVocabItem(item.word, item.meaning, item.example, nowDate, item.tag)
            .card,
      };
    });
    const nextStats: StudyStats = {
      ...stats,
      todayReviewed: 0,
      todayCorrect: 0,
      todayWrong: 0,
    };
    setItems(nextItems);
    setStats(nextStats);
    setIsCramMode(false);
    setCramQueueIds([]);
    scheduleCloudPush(nextItems, allCategories, nextStats);
    showToast(`🔄 [${label}] 복습 일정이 초기화되었습니다.`);
  };

  const handleRate = (grade: Grade) => {
    if (!currentItem) return;

    // 평가 직전 상태를 Undo 스택에 저장 (최대 10개)
    setUndoStack((prev) => [
      ...prev.slice(-9),
      {
        items,
        stats,
        isCramMode,
        cramQueueIds,
        wordLabel: currentItem.word,
      },
    ]);

    const nowDate = new Date();
    const elapsedMs = Math.min(120000, Math.max(500, Date.now() - cardStartTimeRef.current));
    const isEasyOrGood =
        (grade === Rating.Good || grade === Rating.Easy) &&
        (studyMode !== 'spelling' || spellingResult === 'correct') &&
        (studyMode !== 'cloze' || clozeResult !== 'wrong');

    // 자유 복습(벼락치기) 모드일 때: FSRS card.due 일정을 변경하지 않고 큐만 이동
    if (isCramMode) {
      const nextItems = items.map((item) => {
        if (item.id !== currentItem.id) return item;
        const prevStats = item.itemStats ?? createEmptyItemStats();
        return {
          ...item,
          itemStats: {
            wins: prevStats.wins + (isEasyOrGood ? 1 : 0),
            losses: prevStats.losses + (isEasyOrGood ? 0 : 1),
            recentHistory: prevStats.recentHistory,
            totalTimeMs: prevStats.totalTimeMs + elapsedMs,
            lastSolvedAt: nowDate.getTime(),
          },
        };
      });

      const nextStats = recordAnswerStats(stats, isEasyOrGood);
      setItems(nextItems);
      setStats(nextStats);

      if (grade === Rating.Again || grade === Rating.Hard) {
        // 다시/어려움 선택 시 이번 자유 복습 세션 맨 뒤로 보내 다시 테스트
        setCramQueueIds((prev) => {
          const rest = prev.filter((id) => id !== currentItem.id);
          return [...rest, currentItem.id];
        });
      } else {
        // 보통/쉬움 선택 시 이번 자유 복습 세션에서 통과
        setCramQueueIds((prev) => prev.filter((id) => id !== currentItem.id));
      }

      scheduleCloudPush(nextItems, allCategories, nextStats);
      resetCardInteraction();
      return;
    }

    // 일반 FSRS 모드일 때
    const record = scheduler.repeat(currentItem.card, nowDate)[grade];
    const nextCard = { ...record.card };

    if (grade === Rating.Good || grade === Rating.Easy) {
      const tomorrowStart = new Date(
          nowDate.getFullYear(),
          nowDate.getMonth(),
          nowDate.getDate() + 1,
          4,
          0,
          0
      );
      if (nextCard.due.getTime() <= tomorrowStart.getTime()) {
        nextCard.due = tomorrowStart;
      }
    }

    const nextItems = items.map((item) => {
      if (item.id !== currentItem.id) return item;
      const prevStats = item.itemStats ?? createEmptyItemStats();
      return {
        ...item,
        card: nextCard,
        itemStats: {
          wins: prevStats.wins + (isEasyOrGood ? 1 : 0),
          losses: prevStats.losses + (isEasyOrGood ? 0 : 1),
          recentHistory: prevStats.recentHistory,
          totalTimeMs: prevStats.totalTimeMs + elapsedMs,
          lastSolvedAt: nowDate.getTime(),
        },
      };
    });

    const nextStats = recordAnswerStats(stats, isEasyOrGood);
    if (currentItem.card.state === State.New) {
      setTodayNewStudiedCount((prev) => {
        const next = prev + 1;
        saveTodayNewStudiedCount(next);
        return next;
      });
    }
    setItems(nextItems);
    setStats(nextStats);
    scheduleCloudPush(nextItems, allCategories, nextStats);
    resetCardInteraction();
  };

  // 안키 보조 기능 4: PC 키보드 단축키 지원 (Space, 1/2/3/4, R, S, Z)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'study' || showGgModal) return;
      const target = e.target as HTMLElement | null;
      if (
          target &&
          (target.tagName === 'INPUT' ||
              target.tagName === 'TEXTAREA' ||
              target.tagName === 'SELECT')
      ) {
        return;
      }

      // Ctrl+Z 또는 단독 Z: 실행 취소(Undo)
      if ((e.key === 'z' || e.key === 'Z') && undoStack.length > 0) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (!currentItem) return;

      // 자동 재생 (깜빡이 모드) 단축키
      if (studyMode === 'autoplay') {
        if (e.code === 'Space') {
          e.preventDefault();
          setIsAutoPlayPlaying((prev) => !prev);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleAutoplayStep('prev');
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleAutoplayStep('next');
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          exitAutoPlay();
          return;
        }
      }

      // Space: 플래시카드 뒤집기 및 예문 빈칸 정답 확인
      if (e.code === 'Space' && (studyMode === 'flashcard' || studyMode === 'cloze') && !isFlipped) {
        e.preventDefault();
        setIsFlipped(true);
        if (studyMode === 'cloze') {
          speakExampleOrWord(currentItem, speechRate);
        }
        return;
      }

      // 1, 2, 3, 4: 카드 평가 (뒷면이거나 채점 완료 상태일 때)
      const canRate =
          (studyMode === 'flashcard' && isFlipped) ||
          (studyMode === 'cloze' && (isFlipped || clozeResult !== null)) ||
          (studyMode === 'spelling' && spellingResult !== null);

      if (canRate) {
        if (e.key === '1') {
          e.preventDefault();
          handleRate(Rating.Again);
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          handleRate(Rating.Hard);
          return;
        }
        if (e.key === '3') {
          e.preventDefault();
          handleRate(Rating.Good);
          return;
        }
        if (e.key === '4') {
          e.preventDefault();
          handleRate(Rating.Easy);
          return;
        }
      }

      // R: 발음/예문 다시 듣기
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (studyMode === 'cloze') {
          speakExampleOrWord(currentItem, speechRate);
        } else if (studyMode === 'flashcard' && isKoToEn) {
          speakWord(currentItem.word, speechRate);
        } else if (isFlipped || spellingResult) {
          speakExampleOrWord(currentItem, speechRate);
        } else {
          speakWord(currentItem.word, speechRate);
        }
        return;
      }

      // S: 별표(⭐) 토글
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleToggleStar(currentItem.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const submitSpellingAnswer = () => {
    if (!currentItem || !typedAnswer.trim()) return;
    const normalizedInput = typedAnswer.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedTarget = currentItem.word.trim().replace(/\s+/g, ' ').toLowerCase();
    setSpellingResult(normalizedInput === normalizedTarget ? 'correct' : 'wrong');
    speakExampleOrWord(currentItem, speechRate);
  };

  const handleCheckSpelling = (e: FormEvent) => {
    e.preventDefault();
    submitSpellingAnswer();
  };

  const submitClozeAnswer = () => {
    if (!currentItem || !currentClozeData) return;
    const cleanInput = clozeInput.trim();
    if (!cleanInput) {
      setIsFlipped(true);
      speakExampleOrWord(currentItem, speechRate);
      return;
    }
    const inputNorm = cleanInput.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedNorm = currentClozeData.matchedWord.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetNorm = currentClozeData.targetWord.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    const isCorrect = inputNorm === matchedNorm || inputNorm === targetNorm;
    setClozeResult(isCorrect ? 'correct' : 'wrong');
    setIsFlipped(true);
    speakExampleOrWord(currentItem, speechRate);
  };

  const handleCheckCloze = (e: FormEvent) => {
    e.preventDefault();
    submitClozeAnswer();
  };

  const handleSyncFromNas = async (
      silent: boolean = false,
      overrideUrl?: string,
      forceResync: boolean = false
  ) => {
    const targetUrl = (overrideUrl ?? nasWebhookUrl).trim();
    if (!targetUrl || isSyncing) return;

    setIsSyncing(true);
    try {
      const { newItems, newCategories, remoteCloudState } = await fetchNewNasVocab(
          items,
          targetUrl,
          forceResync
      );

      const localUpdated = loadLocalUpdatedAt();
      let baseItems = items;
      let baseCategories = allCategories;
      let baseStats = stats;
      let pulledFromRemote = false;

      if (
          remoteCloudState &&
          remoteCloudState.items.length > 0 &&
          (remoteCloudState.updatedAt > localUpdated || items.length === 0 || forceResync)
      ) {
        baseItems = remoteCloudState.items;
        baseCategories =
            remoteCloudState.categories.length > 0
                ? remoteCloudState.categories
                : Array.from(new Set(remoteCloudState.items.map((it) => normalizeCategory(it.tag))));
        if (remoteCloudState.stats) {
          baseStats = remoteCloudState.stats;
        }
        saveLocalUpdatedAt(remoteCloudState.updatedAt);
        pulledFromRemote = true;
      }

      if (newItems.length > 0) {
        const formattedCats = newCategories.map((c) => normalizeCategory(c));
        const mergedItems = [...newItems, ...baseItems];
        const mergedCats = Array.from(new Set([...baseCategories, ...formattedCats]));
        setItems(mergedItems);
        setCustomCategories(mergedCats);
        setStats(baseStats);
        scheduleCloudPush(mergedItems, mergedCats, baseStats);
        showToast(
            `📥 새 단어 ${newItems.length}개(${formattedCats.join(', ')}) 동기화 완료!`
        );
      } else if (pulledFromRemote) {
        setItems(baseItems);
        setCustomCategories(baseCategories);
        setStats(baseStats);
        if (!silent) {
          showToast(`☁️ 다른 기기의 최신 단어장(${baseItems.length}단어)과 동기화되었습니다!`);
        }
      } else {
        if (
            items.length > 0 &&
            (!remoteCloudState ||
                remoteCloudState.items.length === 0 ||
                localUpdated > (remoteCloudState.updatedAt || 0))
        ) {
          await pushStateToNas(
              {
                updatedAt: localUpdated || saveLocalUpdatedAt(Date.now()),
                items,
                categories: allCategories,
                stats,
              },
              targetUrl
          );
        }
        if (!silent) {
          showToast('☁️ 모든 기기 동기화 완료! 최신 상태입니다.');
        }
      }
    } catch {
      if (!silent) {
        showToast('NAS 연결에 실패했습니다. 웹훅 주소와 n8n Publish 상태를 확인해 주세요.');
      }
    } finally {
      setIsSyncing(false);
    }
  };


  const handleSaveNasWebhook = () => {
    saveNasWebhookUrl(nasUrlInput);
    const saved = loadNasWebhookUrl();
    setNasWebhookUrl(saved);
    if (saved) {
      showToast('NAS n8n 웹훅 주소가 저장되었습니다.');
      handleSyncFromNas(false, saved, false);
    }
  };

  const handleClearNasRemote = async () => {
    if (!window.confirm('NAS(n8n) 대기열에 저장된 이전 스캔 기록을 비우시겠습니까?')) return;
    try {
      await clearNasRemoteDb(nasWebhookUrl);
      showToast('NAS 대기열 데이터가 초기화되었습니다.');
    } catch {
      showToast('NAS 초기화 요청 중 오류가 발생했습니다.');
    }
  };

  useEffect(() => {
    if (nasWebhookUrl) {
      handleSyncFromNas(true, nasWebhookUrl, false);
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && nasWebhookUrl) {
        handleSyncFromNas(true, nasWebhookUrl, false);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveApiKey = () => {
    saveGeminiApiKey(apiKeyInput);
    const saved = loadGeminiApiKey();
    setGeminiApiKey(saved);
    setShowApiKeyEditor(false);
    showToast(saved ? 'Gemini API 키가 저장되었습니다.' : 'API 키가 삭제되었습니다.');
  };

  const handlePhotosSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = '';

    setOcrError('');
    setExtractedDrafts([]);
    setIsExtracting(true);

    try {
      const resizedPayloads = await Promise.all(
          files.map((file) => resizeImageToBase64(file, 2048))
      );
      const extracted = await extractVocabFromImages(
          resizedPayloads.map((p) => ({ base64: p.base64, mimeType: p.mimeType })),
          geminiApiKey
      );

      if (extracted.length === 0) {
        setOcrError('사진에서 영어 단어를 찾지 못했습니다.');
      } else {
        const nowTs = Date.now();
        setExtractedDrafts(
            extracted.map((item, idx) => ({
              id: `draft-${nowTs}-${idx}`,
              unit: item.unit || '',
              word: item.word,
              phonetic: item.phonetic || '',
              meaning: item.meaning,
              example: item.example || '',
              selected: true,
            }))
        );
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '사진 분석 중 오류가 발생했습니다.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleUpdateDraft = (
      id: string,
      field: 'unit' | 'word' | 'phonetic' | 'meaning' | 'example' | 'selected',
      value: string | boolean
  ) => {
    setExtractedDrafts((prev) =>
        prev.map((draft) => (draft.id === id ? { ...draft, [field]: value } : draft))
    );
  };

  const handleSaveExtractedDrafts = () => {
    const selectedItems = extractedDrafts.filter(
        (d) => d.selected && d.word.trim() && d.meaning.trim()
    );
    if (selectedItems.length === 0) return;

    const nowTs = Date.now();
    const createdFolders = new Set<string>();

    const created = selectedItems.map((draft, idx) => {
      const folderPath = resolveItemFolder(targetCategory, draft.unit);
      createdFolders.add(folderPath);
      return createNewVocabItem(
          draft.word,
          draft.meaning,
          draft.example,
          new Date(nowTs + idx),
          folderPath,
          draft.phonetic
      );
    });

    const folderList = Array.from(createdFolders);
    const nextCats = Array.from(new Set([...allCategories, ...folderList]));
    const nextItems = [...created, ...items];
    setCustomCategories(nextCats);
    setItems(nextItems);
    setExtractedDrafts([]);
    scheduleCloudPush(nextItems, nextCats, stats);
    showToast(
        `📂 [${folderList.join(', ')}] 폴더에 총 ${created.length}개 단어가 분리 저장되었습니다.`
    );
  };

  const handleAddSingle = (e: FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !newMeaning.trim()) return;
    const normFolder = normalizeCategory(targetCategory);
    const created = createNewVocabItem(
        newWord,
        newMeaning,
        newExample,
        new Date(),
        normFolder,
        newPhonetic
    );
    const nextCats = Array.from(new Set([...allCategories, normFolder]));
    const nextItems = [created, ...items];
    setCustomCategories(nextCats);
    setItems(nextItems);
    setNewWord('');
    setNewPhonetic('');
    setNewMeaning('');
    setNewExample('');
    scheduleCloudPush(nextItems, nextCats, stats);
    showToast(`[${normFolder}]에 "${created.word}" 단어가 추가되었습니다.`);
  };

  const handleDeleteItem = (item: VocabItem) => {
    if (!window.confirm(`"${item.word}" 단어를 정말 삭제하시겠습니까?`)) return;
    const nextItems = items.filter((it) => it.id !== item.id);
    setItems(nextItems);
    if (editingId === item.id) setEditingId(null);
    scheduleCloudPush(nextItems, allCategories, stats);
    showToast(`🗑️ "${item.word}" 단어가 삭제되었습니다.`);
  };

  const handleExportJson = () => {
    const payload = {
      app: '소이의 단어 암기장',
      version: 8,
      exportedAt: new Date().toISOString(),
      categories: allCategories,
      items: selectedPoolItems.length > 0 ? selectedPoolItems : items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soi-vocab-backup-${getDateKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('단어장 백업 파일(JSON)을 내보냈습니다.');
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseImportedVocab(text);
      if (imported.length === 0) return;
      const map = new Map<string, VocabItem>();
      items.forEach((item) =>
          map.set(`${normalizeCategory(item.tag)}::${item.word.toLowerCase()}`, item)
      );
      imported.forEach((item) =>
          map.set(`${normalizeCategory(item.tag)}::${item.word.toLowerCase()}`, item)
      );
      const nextItems = Array.from(map.values());
      const nextCats = Array.from(
          new Set([...allCategories, ...nextItems.map((it) => normalizeCategory(it.tag))])
      );
      setItems(nextItems);
      setCustomCategories(nextCats);
      scheduleCloudPush(nextItems, nextCats, stats);
      showToast(`${imported.length}개의 단어를 불러왔습니다.`);
    } catch {
      showToast('백업 파일을 읽는 중 오류가 발생했습니다.');
    } finally {
      e.target.value = '';
    }
  };

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (!isCategoryMatch(item.tag, listCategory)) return false;
      if (studyFilter === 'starred' && !item.starred) return false;
      if (studyFilter === 'weak' && !isWeakItem(item)) return false;
      if (!q) return true;
      return (
          item.word.toLowerCase().includes(q) ||
          item.meaning.toLowerCase().includes(q) ||
          (item.example && item.example.toLowerCase().includes(q))
      );
    });
  }, [items, searchQuery, listCategory, studyFilter]);

  const currentCardMetrics = useMemo(() => {
    const st = currentItem?.itemStats ?? createEmptyItemStats();
    const totalTries = st.wins + st.losses;
    const avgSec =
        totalTries > 0 ? (st.totalTimeMs / totalTries / 1000).toFixed(1) : '0.0';
    return {
      totalTries,
      avgSec,
      lastSolved: formatDateTime(st.lastSolvedAt),
    };
  }, [currentItem]);

  const now = new Date();
  const scheduling = currentItem ? scheduler.repeat(currentItem.card, now) : null;
  const ratingOptions: Array<{
    grade: Grade;
    label: string;
    className: string;
    intervalText: string;
  }> = scheduling
      ? [
        {
          grade: Rating.Again,
          label: '다시 (1)',
          className: 'rate-again',
          intervalText: isCramMode
              ? '1분 뒤 (세션 끝)'
              : formatInterval(scheduling[Rating.Again].card.due, now),
        },
        {
          grade: Rating.Hard,
          label: '어려움 (2)',
          className: 'rate-hard',
          intervalText: isCramMode
              ? '5분 뒤 (세션 끝)'
              : formatInterval(scheduling[Rating.Hard].card.due, now),
        },
        {
          grade: Rating.Good,
          label: '보통 (3)',
          className: 'rate-good',
          intervalText: isCramMode
              ? '이번 복습 통과'
              : scheduling[Rating.Good].card.due.getTime() <=
              new Date().setHours(23, 59, 59, 999)
                  ? '1일 뒤'
                  : formatInterval(scheduling[Rating.Good].card.due, now),
        },
        {
          grade: Rating.Easy,
          label: '쉬움 (4)',
          className: 'rate-easy',
          intervalText: isCramMode
              ? '이번 복습 통과'
              : formatInterval(scheduling[Rating.Easy].card.due, now),
        },
      ]
      : [];

  const allCounts = getFolderCounts('ALL');

  return (
      <div className="app-shell">
        {/* 심플하고 현대적인 상단 헤더 */}
        
        <header className="app-header">
          <div className="header-top-bar">
            <div>
              <div className="title-row">
                <h1 className="app-title">소이의 단어 암기장</h1>
                <button
                    type="button"
                    className="help-circle-btn"
                    onClick={() => setShowFsrsModal(true)}
                    title="FSRS 과학적 암기법이란?"
                >
                  <HelpCircle size={14} />
                </button>
              </div>
              <div className="header-meta-row">
                <span className="streak-pill" title={`연속 학습 ${stats.streak}일째`}>
                  <Flame size={12} />
                  {stats.streak}일째
                </span>

                {isCramMode ? (
                  <span className="due-pill" title="자유 복습(벼락치기) 대기 단어">
                    벼락치기 {dueItems.length}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`daily-goal-pill ${stats.todayReviewed >= dailyGoal ? 'goal-achieved' : ''}`}
                    onClick={() => setShowBottomStats(true)}
                    title={`오늘 완료: ${stats.todayReviewed}회 / 목표: ${dailyGoal}회 (전체 대기: ${totalDueInPool}개) - 클릭 시 목표 변경`}
                  >
                    <span>{stats.todayReviewed >= dailyGoal ? '🏆' : '🎯'}</span>
                    <span>
                      오늘 <strong>{stats.todayReviewed}</strong>/{dailyGoal}
                    </span>
                    {totalDueInPool > 0 && (
                      <span className="goal-aux-pending" title={`전체 대기 단어: ${totalDueInPool}개`}>
                        (대기 {totalDueInPool})
                      </span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  className="header-folder-pill"
                  onClick={() => setShowGgModal(true)}
                  title={`현재 학습 폴더: ${studyCategory === 'ALL' ? '전체 단어장' : studyCategory} (클릭 시 변경)`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: studyCategory === 'ALL' ? '#f1f5f9' : '#fef9c3',
                    color: studyCategory === 'ALL' ? '#475569' : '#854d0e',
                    border: studyCategory === 'ALL' ? '1px solid #cbd5e1' : '1px solid #facc15',
                    borderRadius: 9999,
                    padding: '2px 8px',
                    fontSize: '0.73rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <FolderOpen size={11} />
                  <span>
                    {studyCategory === 'ALL' ? '전체' : studyCategory.split('/').pop()}
                  </span>
                  <span style={{ opacity: 0.8, fontSize: '0.68rem', fontWeight: 600 }}>
                    ({selectedPoolItems.length})
                  </span>
                </button>

                {/* 메인 학습 화면 빠른 필터 전환 (전체 / ⭐ / 🔥) */}
                <div className="header-filter-group" title="학습 단어 필터 (전체 / 별표 / 취약)">
                  <button
                    type="button"
                    className={`header-filter-chip ${studyFilter === 'all' ? 'active' : ''}`}
                    onClick={() => {
                      setStudyFilter('all');
                      if (isCramMode) setCramQueueIds(selectedPoolItems.map((it) => it.id));
                      resetCardInteraction();
                    }}
                    title="모든 단어 학습"
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    className={`header-filter-chip star ${studyFilter === 'starred' ? 'active' : ''}`}
                    onClick={() => {
                      setStudyFilter('starred');
                      if (isCramMode) {
                        setCramQueueIds(selectedPoolItems.filter((it) => it.starred).map((it) => it.id));
                      }
                      resetCardInteraction();
                    }}
                    title={`별표 단어만 학습 (${starredCount}개)`}
                  >
                    <Star size={11} fill={studyFilter === 'starred' ? 'currentColor' : 'none'} />
                    <span>{starredCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`header-filter-chip weak ${studyFilter === 'weak' ? 'active' : ''}`}
                    onClick={() => {
                      setStudyFilter('weak');
                      if (isCramMode) {
                        setCramQueueIds(selectedPoolItems.filter((it) => isWeakItem(it)).map((it) => it.id));
                      }
                      resetCardInteraction();
                    }}
                    title={`취약 단어만 학습 (${weakCount}개)`}
                  >
                    <Flame size={11} />
                    <span>{weakCount}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="header-actions">
              <button
                  type="button"
                  className={`header-direction-btn ${flashcardDirection}`}
                  onClick={handleToggleFlashcardDirection}
                  title="단어 암기 방향 전환 (클릭 시 영→한 / 한→영 / 한·영 랜덤 순환)"
              >
                {flashcardDirection === 'en-ko' && <span>영 → 한</span>}
                {flashcardDirection === 'ko-en' && <span>한 → 영</span>}
                {flashcardDirection === 'random' && (
                  <>
                    <Shuffle size={13} />
                    <span>랜덤</span>
                  </>
                )}
              </button>
              {nasWebhookUrl && (
                  <button
                      type="button"
                      className="header-icon-btn"
                      onClick={() => handleSyncFromNas(false, undefined, false)}
                      title="PC · 스마트폰 즉시 동기화"
                  >
                    <RefreshCw size={17} className={isSyncing ? 'spin' : ''} />
                  </button>
              )}
              <button
                  type="button"
                  className="header-icon-btn"
                  onClick={() => setShowGgModal(true)}
                  title="문제집 폴더 선택 및 관리"
              >
                <FolderOpen size={17} />
              </button>
              <button
                  type="button"
                  className="header-icon-btn"
                  onClick={() => setShowBottomStats(true)}
                  title="학습 옵션 & 환경 설정"
              >
                <Settings2 size={17} />
              </button>
            </div>
          </div>

          {/* 오늘의 목표 달성률 전체 가로 폭 진행률 바 */}
          {!isCramMode && (
            <div
              className="daily-progress-wrap"
              onClick={() => setShowBottomStats(true)}
              title={`오늘 학습 목표 달성률: ${Math.min(100, Math.round((stats.todayReviewed / dailyGoal) * 100))}% (${stats.todayReviewed}/${dailyGoal} 완료)`}
            >
              <div
                className={`daily-progress-bar ${stats.todayReviewed >= dailyGoal ? 'achieved' : ''}`}
                style={{
                  width: `${Math.min(100, Math.max(0, (stats.todayReviewed / dailyGoal) * 100))}%`,
                }}
              />
            </div>
          )}
        </header>

        {toastMsg && <div className="toast-banner">{toastMsg}</div>}

        {/* FSRS 과학적 암기법 상세 설명 팝업 모달 */}
        {showFsrsModal && (
            <div className="gg-modal-backdrop" onClick={() => setShowFsrsModal(false)}>
              <div className="gg-modal" onClick={(e) => e.stopPropagation()}>
                <div className="gg-modal-header">
              <span className="gg-modal-title">
                <Sparkles size={18} color="#eab308" />
                FSRS 망각곡선 암기법이란 무엇인가요?
              </span>
                  <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => setShowFsrsModal(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="fsrs-guide-box">
                  <h4>🧠 1. 뇌과학과 AI가 결합된 차세대 기억 알고리즘</h4>
                  <div>
                    사람의 뇌는 새로운 영단어를 외운 뒤 <strong>1시간이 지나면 50%, 하루가 지나면 70%</strong>를
                    잊어버립니다(에빙하우스의 망각곡선). 하지만 <strong>&ldquo;잊어버리기 바로 직전의 골든타임&rdquo;</strong>에
                    단어를 다시 떠올리면, 뇌는 그 단어를 <strong>평생 가는 장기 기억</strong>으로 전환합니다.
                    <br />
                    <strong>FSRS(Free Spaced Repetition Scheduler)</strong>는 수억 건의 실제 암기 데이터를 학습해,
                    소이가 단어마다 언제 복습해야 가장 적은 노력으로 오래 기억할 수 있는지 계산해 주는 최신 알고리즘입니다.
                  </div>
                </div>

                <div className="fsrs-guide-box">
                  <h4>💡 2. 왜 일반 단어장 대신 FSRS 공부법을 해야 할까요?</h4>
                  <ul className="fsrs-effect-list">
                    <li>
                      <strong>다 아는 단어를 또 보는 시간 낭비 제거:</strong> 종이 단어장을 처음부터 끝까지 읽으면
                      이미 완벽히 아는 단어에 시간의 70%를 낭비하게 됩니다. FSRS는 쉬운 단어는 <strong>4일 뒤 → 14일 뒤 → 한 달 뒤</strong>로
                      멀리 보내고, 오늘 꼭 봐야 할 단어만 뽑아줍니다.
                    </li>
                    <li>
                      <strong>공부 시간은 절반으로, 암기량은 2배로:</strong> 연구 결과 일반 반복 학습 대비
                      <strong> 학습 시간을 35~50% 단축</strong>하면서도 기억 유지율은 <strong>90% 이상</strong>으로 유지됩니다.
                    </li>
                    <li>
                      <strong>소이에게 맞춘 개인별 난이도 자동 조절:</strong> 헷갈리는 단어는 <code>다시</code>나{' '}
                      <code>어려움</code>을 누르면 오늘 끝부분과 내일 다시 나타나 완벽히 외울 때까지 도와줍니다.
                    </li>
                  </ul>
                </div>

                <div className="fsrs-guide-box">
                  <h4>🚀 3. 소이를 위한 100% 활용 꿀팁!</h4>
                  <ul className="fsrs-effect-list">
                    <li>
                      <strong>1단계 (눈과 귀로 익히기):</strong> 카드를 보기만 하지 말고 원어민 발음과 영어 예문을 귀로 들으며 뜻을 확인하세요.
                    </li>
                    <li>
                      <strong>2단계 (솔직하게 버튼 누르기):</strong> 바로 떠오르면 <strong>쉬움/보통</strong>, 3초 이상 고민했거나 틀렸다면 주저 없이 <strong>다시/어려움</strong>을 눌러주세요.
                    </li>
                    <li>
                      <strong>3단계 (스펠링 & 벼락치기):</strong> 학원 시험 전날에는 <strong>스펠링 테스트</strong>와 <strong>⚡ 자유 복습(벼락치기)</strong>으로 완벽하게 마무리하세요!
                    </li>
                  </ul>
                </div>

                <button
                    type="button"
                    className="primary-full-btn"
                    onClick={() => setShowFsrsModal(false)}
                >
                  이해했어요! 오늘 복습 시작하기
                </button>
              </div>
            </div>
        )}

        {/* 1. 문제집 폴더 선택 & 순서/이름 관리 모달 */}
        {showGgModal && (
            <div className="gg-modal-backdrop" onClick={() => setShowGgModal(false)}>
              <div className="gg-modal" onClick={(e) => e.stopPropagation()}>
                <div className="gg-modal-header">
                  <span className="gg-modal-title">
                    <FolderOpen size={18} />
                    문제집 폴더 선택 & 관리
                  </span>
                  <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => setShowGgModal(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="gg-box">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '10px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.74rem', color: '#854d0e', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Sparkles size={13} color="#eab308" />
                      3단계 폴더(시리즈 &gt; 권 &gt; 강)와 접기 방법이 궁금하신가요?
                    </span>
                    <button
                      type="button"
                      className="helper-chip"
                      style={{ fontSize: '0.7rem', padding: '2px 8px', background: '#fef08a', color: '#854d0e', borderColor: '#facc15', fontWeight: 700, cursor: 'pointer' }}
                      onClick={() => setShowFolderGuideModal(true)}
                    >
                      📖 설명서 보기
                    </button>
                  </div>

                  <div className="gg-box-title">
                    새 폴더 만들기 (▲/▼ 위치 변경 · ✏️ 이름/상위폴더 수정)
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                        type="text"
                        className="mini-input"
                        placeholder="시리즈/책 (예: 영어책이름 또는 영어책이름/1권)"
                        value={newParentFolder}
                        onChange={(e) => setNewParentFolder(e.target.value)}
                    />
                    <input
                        type="text"
                        className="mini-input"
                        placeholder="하위 권/강 (예: 1권 또는 01강)"
                        value={newChildFolder}
                        onChange={(e) => setNewChildFolder(e.target.value)}
                    />
                    <button
                        type="button"
                        className="submit-btn"
                        style={{ whiteSpace: 'nowrap', padding: '0 12px' }}
                        onClick={handleAddFolderHierarchy}
                    >
                      + 생성
                    </button>
                  </div>

                  <div className="gg-tree-scroll">
                    <div className="folder-item-wrap">
                      <button
                          type="button"
                          className={`folder-item ${studyCategory === 'ALL' ? 'active' : ''}`}
                          onClick={() => {
                            setStudyCategory('ALL');
                            setIsCramMode(false);
                            setAutoPlayIndex(0);
                            resetCardInteraction();
                            setShowGgModal(false);
                          }}
                      >
                    <span className="folder-item-left">
                      <FolderOpen size={15} />
                      <span className="folder-name">전체 단어장 (All Units)</span>
                    </span>
                        <span className="folder-count">
                      {allCounts.due}/{allCounts.total}
                    </span>
                      </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, margin: '6px 0 2px' }}>
                      <button
                          type="button"
                          className="helper-chip"
                          style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                          onClick={handleCollapseAll}
                      >
                        모두 접기
                      </button>
                      <button
                          type="button"
                          className="helper-chip"
                          style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                          onClick={handleExpandAll}
                      >
                        모두 펼치기
                      </button>
                    </div>

                    {categoryTree.map((node, nIdx) =>
                      renderCategoryNode(node, true, categoryTree, nIdx)
                    )}
                  </div>
                </div>

                <div className="gg-summary-box">
                  <div>
                    현재 폴더: <strong>{studyCategory === 'ALL' ? '전체 단어장' : studyCategory}</strong> (
                    {selectedPoolItems.length}단어)
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                        type="button"
                        className="secondary-btn"
                        onClick={handleResetFolderStats}
                    >
                      일정 초기화
                    </button>
                    <button
                        type="button"
                        className="submit-btn"
                        onClick={() => setShowGgModal(false)}
                    >
                      닫기
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* 문제집 폴더 관리 설명서 팝업창 */}
        <FolderGuideModal
          isOpen={showFolderGuideModal}
          onClose={() => setShowFolderGuideModal(false)}
        />

        {/* 2-1. 깜빡이 암기 전용 옵션 모달 */}
        {showAutoPlayOptionsModal && (
            <div className="gg-modal-backdrop" onClick={() => setShowAutoPlayOptionsModal(false)}>
              <div className="gg-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <div className="gg-modal-header">
                  <span className="gg-modal-title">
                    <Settings2 size={18} />
                    깜빡이 암기 옵션 설정
                  </span>
                  <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => setShowAutoPlayOptionsModal(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* ① 문제 노출 시간 */}
                <div className="settings-section">
                  <div className="settings-section-title">
                    <span>⏱️ 문제 노출 시간 (앞면 대기)</span>
                    <span style={{ color: '#854d0e', fontWeight: 800 }}>{autoPlayInterval}초</span>
                  </div>
                  <p style={{ fontSize: '0.76rem', color: '#64748b', margin: '4px 0 8px' }}>
                    문제를 눈으로 보고 머릿속으로 떠올릴 수 있도록 대기하는 시간입니다.
                  </p>
                  <div className="autoplay-select-wrapper" style={{ width: '100%' }}>
                    <select
                        className="autoplay-select-btn"
                        style={{ width: '100%', padding: '9px 30px 9px 12px' }}
                        value={autoPlayInterval}
                        onChange={(e) => handleUpdateAutoPlayInterval(Number(e.target.value))}
                    >
                      {AUTO_PLAY_INTERVAL_OPTIONS.map((sec) => (
                          <option key={sec} value={sec}>
                            {sec}초 동안 문제 노출
                          </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="autoplay-select-arrow" />
                  </div>
                </div>

                {/* ② 답 발음 반복 횟수 */}
                <div className="settings-section">
                  <div className="settings-section-title">
                    <span>🔁 답 발음 반복 횟수</span>
                    <span style={{ color: '#854d0e', fontWeight: 800 }}>{autoPlayRepeatCount}회</span>
                  </div>
                  <p style={{ fontSize: '0.76rem', color: '#64748b', margin: '4px 0 8px' }}>
                    정답 화면에서 발음을 몇 번 반복해서 들려줄지 선택합니다. (반복 시 따라 읽을 수 있도록 1초 간격 제공)
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[1, 2, 3].map((cnt) => (
                        <button
                            key={cnt}
                            type="button"
                            className={`filter-chip ${autoPlayRepeatCount === cnt ? 'active' : ''}`}
                            style={{ flex: 1, padding: '9px 0', textAlign: 'center', fontWeight: 800 }}
                            onClick={() => handleUpdateAutoPlayRepeatCount(cnt)}
                        >
                          {cnt}회 {cnt === 1 ? '(기본)' : '반복'}
                        </button>
                    ))}
                  </div>
                </div>

                {/* ③ 한글 문제 & 정답 음성 읽기 (TTS) */}
                <div className="settings-section">
                  <div className="settings-section-title">
                    <span>🗣️ 한글 문제 & 정답 음성 읽기 (TTS)</span>
                    <span style={{ color: autoPlayKoreanTts ? '#15803d' : '#64748b', fontWeight: 800 }}>
                      {autoPlayKoreanTts ? '켜짐' : '꺼짐'}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.76rem', color: '#64748b', margin: '4px 0 8px' }}>
                    영어 발음과 함께 한국어 뜻도 우리말 음성으로 또박또박 읽어줍니다.
                  </p>
                  <button
                      type="button"
                      className={`auto-audio-btn ${autoPlayKoreanTts ? 'on' : ''}`}
                      style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                      onClick={handleToggleAutoPlayKoreanTts}
                  >
                    <Volume2 size={16} />
                    {autoPlayKoreanTts ? '✓ 한국어 음성 읽기 켜짐 (터치 시 끄기)' : '한국어 음성 읽기 꺼짐 (터치 시 켜기)'}
                  </button>
                </div>

                {/* ④ 답 읽기 완료 시 즉시 이동 안내 */}
                <div className="settings-section" style={{ background: '#f8fafc', padding: '11px 13px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#334155', fontWeight: 700 }}>
                    <Zap size={14} color="#eab308" />
                    답 TTS 읽기 완료 시 다음 문제로 바로 이동
                  </div>
                  <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '3px 0 0' }}>
                    답 발음(첫 번째 문장/단어)이 끝나면 대기 시간 없이 즉시 다음 문제로 넘어갑니다.
                  </p>
                </div>

                <div style={{ marginTop: 16 }}>
                  <button
                      type="button"
                      className="submit-btn"
                      style={{ width: '100%', padding: '12px' }}
                      onClick={() => setShowAutoPlayOptionsModal(false)}
                  >
                    확인 및 닫기
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* 2. 새로 통합된 '학습 옵션 & 설정' 모달 */}
        {showBottomStats && (
            <div className="gg-modal-backdrop" onClick={() => setShowBottomStats(false)}>
              <div className="gg-modal" onClick={(e) => e.stopPropagation()}>
                <div className="gg-modal-header">
              <span className="gg-modal-title">
                <Settings2 size={18} />
                학습 옵션 & 환경 설정
              </span>
                  <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => setShowBottomStats(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* 🎯 오늘의 학습 목표 & 하루 새 단어 제한 설정 */}
                <div className="settings-section">
                  <div className="settings-section-title">
                    <span>🎯 오늘의 학습 목표 & 새 단어 제한</span>
                    <span style={{ color: '#854d0e', fontWeight: 800 }}>
                      목표 {dailyGoal}개 · 새 단어 {dailyNewLimit === 0 ? '제한 없음' : `${dailyNewLimit}개/일`}
                    </span>
                  </div>

                  {/* ① 일일 복습 목표 */}
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                        일일 복습 목표 (상단 진행률 바 기준)
                      </span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                        현재 {dailyGoal}개
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[20, 30, 50, 100].map((goal) => (
                        <button
                          key={goal}
                          type="button"
                          className={`filter-chip ${dailyGoal === goal ? 'active' : ''}`}
                          style={{ flex: 1, padding: '7px 0', textAlign: 'center', fontWeight: 800 }}
                          onClick={() => handleUpdateDailyGoal(goal)}
                        >
                          {goal}개
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ② 하루 새 단어 제한 */}
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                        하루 새 단어 제한 (New Cards Limit)
                      </span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                        {dailyNewLimit === 0 ? '제한 없음' : `${dailyNewLimit}개/일`}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.74rem', color: '#64748b', margin: '2px 0 6px' }}>
                      하루에 무리하지 않도록 처음 보는 새 단어의 출제 수를 조절합니다. (오늘 학습한 새 단어: <strong>{todayNewStudiedCount}개</strong>)
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[10, 20, 30, 50, 0].map((limit) => (
                        <button
                          key={limit}
                          type="button"
                          className={`filter-chip ${dailyNewLimit === limit ? 'active' : ''}`}
                          style={{ flex: 1, padding: '7px 0', textAlign: 'center', fontWeight: 800 }}
                          onClick={() => handleUpdateDailyNewLimit(limit)}
                        >
                          {limit === 0 ? '제한 없음' : `${limit}개`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ① 발음 속도 및 자동 재생 */}
                <div className="settings-section">
                  <div className="settings-section-title">
                    <span>🔊 원어민 발음(TTS) 속도 및 자동 재생</span>
                    <span>현재 {speechRate}x</span>
                  </div>
                  <div className="option-row">
                    <div className="speed-group">
                      {SPEECH_RATES.map((r) => (
                          <button
                              key={r}
                              type="button"
                              className={`speed-chip ${speechRate === r ? 'active' : ''}`}
                              onClick={() => {
                                speechRateRef.current = r;
                                setSpeechRate(r);
                                if (currentItem) {
                                  if (isFlipped || spellingResult) {
                                    speakExampleOrWord(currentItem, r);
                                  } else {
                                    speakWord(currentItem.word, r);
                                  }
                                }
                              }}
                          >
                            {r}x
                          </button>
                      ))}
                    </div>
                    <button
                        type="button"
                        className={`auto-audio-btn ${autoSpeak ? 'on' : ''}`}
                        onClick={() => setAutoSpeak((prev) => !prev)}
                    >
                      <Volume2 size={14} />
                      {autoSpeak ? '자동 읽어주기 켜짐' : '수동 재생'}
                    </button>
                  </div>
                </div>

                {/* ② 깜빡이 암기 모드 전용 옵션 */}
                <div className="settings-section">
                  <div className="settings-section-title">
                    <span>⚡ 깜빡이 암기 모드 옵션</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                        답 발음 반복 횟수
                      </span>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {[1, 2, 3].map((cnt) => (
                            <button
                                key={cnt}
                                type="button"
                                className={`filter-chip ${autoPlayRepeatCount === cnt ? 'active' : ''}`}
                                style={{ padding: '5px 10px', fontSize: '0.74rem', fontWeight: 800 }}
                                onClick={() => handleUpdateAutoPlayRepeatCount(cnt)}
                            >
                              {cnt}회 {cnt === 1 ? '(기본)' : '반복'}
                            </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                        한글 문제 & 정답 음성 읽기 (TTS)
                      </span>
                      <button
                          type="button"
                          className={`auto-audio-btn ${autoPlayKoreanTts ? 'on' : ''}`}
                          style={{ padding: '5px 10px', fontSize: '0.74rem' }}
                          onClick={handleToggleAutoPlayKoreanTts}
                      >
                        <Volume2 size={13} />
                        {autoPlayKoreanTts ? '한국어 켜짐' : '영어만'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ② 집중 필터 & 자유 복습(벼락치기) */}
                <div className="settings-section">
                  <div className="settings-section-title">
                    <span>🎯 단어 필터 & 시험 전 자유 복습 (벼락치기)</span>
                  </div>
                  <div className="filter-chip-group">
                    <button
                        type="button"
                        className={`filter-chip ${studyFilter === 'all' ? 'active' : ''}`}
                        onClick={() => {
                          setStudyFilter('all');
                          if (isCramMode) setCramQueueIds(selectedPoolItems.map((it) => it.id));
                          resetCardInteraction();
                        }}
                    >
                      전체 단어 ({selectedPoolItems.length})
                    </button>
                    <button
                        type="button"
                        className={`filter-chip star ${studyFilter === 'starred' ? 'active' : ''}`}
                        onClick={() => {
                          setStudyFilter('starred');
                          if (isCramMode) {
                            setCramQueueIds(
                                selectedPoolItems.filter((it) => it.starred).map((it) => it.id)
                            );
                          }
                          resetCardInteraction();
                        }}
                    >
                      <Star size={13} fill={studyFilter === 'starred' ? 'currentColor' : 'none'} />
                      별표 단어 ({starredCount})
                    </button>
                    <button
                        type="button"
                        className={`filter-chip weak ${studyFilter === 'weak' ? 'active' : ''}`}
                        onClick={() => {
                          setStudyFilter('weak');
                          if (isCramMode) {
                            setCramQueueIds(
                                selectedPoolItems
                                    .filter((it) => isWeakItem(it))
                                    .map((it) => it.id)
                            );
                          }
                          resetCardInteraction();
                        }}
                    >
                      <Flame size={13} />
                      취약 단어 ({weakCount})
                    </button>
                  </div>

                  <button
                      type="button"
                      className={`cram-toggle-btn ${isCramMode ? 'active' : ''}`}
                      onClick={() => {
                        if (isCramMode) {
                          exitCramMode();
                        } else {
                          startCramMode();
                          setShowBottomStats(false);
                        }
                      }}
                  >
                    <Zap size={15} />
                    {isCramMode
                        ? '자유 복습(벼락치기) 종료하고 일반 모드로 복귀'
                        : `FSRS 일정 유지한 채 자유 복습(벼락치기) 시작 (${filteredPoolItems.length}단어)`}
                  </button>
                </div>

                {/* ③ 상세 학습 통계 */}
                <div className="settings-section">
                  <div className="settings-section-title">
                <span>
                  <BarChart2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  상세 학습 통계
                </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#334155', lineHeight: 1.6 }}>
                    <div>
                      • 오늘 완료한 복습: <strong>{stats.todayReviewed}회</strong> / 목표 {dailyGoal}회 (연속{' '}
                      <strong>{stats.streak}일째</strong> 학습 중)
                    </div>
                    <div>
                      • 오늘 학습한 새 단어: <strong>{todayNewStudiedCount}개</strong> (일일 제한: {dailyNewLimit === 0 ? '제한 없음' : `${dailyNewLimit}개`}) · 전체 대기: <strong>{totalDueInPool}개</strong>
                    </div>
                    <div>
                      • 선택 폴더 평균 풀이 시간: <strong>{selectionMetrics.avgSec}초</strong> (누적{' '}
                      {selectionMetrics.totalTries}회)
                    </div>
                    {currentItem && (
                        <div>
                          • 현재 단어 누적 복습: <strong>{currentCardMetrics.totalTries}회</strong> ·
                          마지막 풀이: {currentCardMetrics.lastSolved}
                        </div>
                    )}
                  </div>
                </div>

                {/* ④ NAS 클라우드 동기화 및 기기 설정 */}
                <div className="settings-section">
                  <div className="settings-section-title">
                <span>
                  <Server size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  PC · 스마트폰 클라우드 동기화 (NAS n8n)
                </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                        type="url"
                        className="mini-input"
                        style={{ flex: 1 }}
                        value={nasUrlInput}
                        onChange={(e) => setNasUrlInput(e.target.value)}
                        placeholder="https://.../webhook/soi-vocab-inbox"
                    />
                    <button type="button" className="submit-btn" onClick={handleSaveNasWebhook}>
                      저장
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => handleSyncFromNas(false, nasUrlInput, true)}
                    >
                      🔄 서버 데이터 전체 다시 불러오기
                    </button>
                    <button
                        type="button"
                        className="secondary-btn"
                        style={{ color: '#dc2626' }}
                        onClick={handleClearNasRemote}
                    >
                      🗑️ NAS 대기열 비우기
                    </button>
                    {deferredPrompt && (
                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={handleInstallPwa}
                        >
                          <Smartphone size={13} /> 홈 화면에 앱 설치
                        </button>
                    )}
                  </div>
                </div>

                {/* FSRS 과학적 망각곡선 원리 상세 안내 링크 */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                  <button
                    type="button"
                    className="fsrs-info-link-btn"
                    onClick={() => {
                      setShowBottomStats(false);
                      setShowFsrsModal(true);
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={15} color="#eab308" />
                      <span>FSRS 망각곡선 암기법이란? (과학적 원리 알아보기)</span>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                </div>

                <button
                    type="button"
                    className="primary-full-btn"
                    onClick={() => setShowBottomStats(false)}
                >
                  확인
                </button>
              </div>
            </div>
        )}

        {/* 3. 엑셀 파일로 단어 일괄 등록 모달 */}
        <ExcelImportModal
            isOpen={showExcelModal}
            onClose={() => setShowExcelModal(false)}
            targetCategory={targetCategory}
            allCategories={allCategories}
            existingItems={items}
            onImport={(nextItems, nextCategories, summary) => {
              setItems(nextItems);
              setCustomCategories(nextCategories);
              scheduleCloudPush(nextItems, nextCategories, stats);
              showToast(
                  `📊 엑셀 등록 완료! 신규 ${summary.added}개 추가` +
                  (summary.updated > 0 ? `, ${summary.updated}개 업데이트` : '') +
                  (summary.skipped > 0 ? `, ${summary.skipped}개 중복 건너뜀` : '')
              );
            }}
        />

        {/* ✏️ 단어 즉시 수정 (오타 교정) 인라인 모달 */}
        {quickEditItem && (
          <div className="gg-modal-backdrop" onClick={() => setQuickEditItem(null)}>
            <div className="gg-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
              <div className="gg-modal-header">
                <span className="gg-modal-title">
                  <Pencil size={18} color="#eab308" />
                  단어 오타 즉시 수정
                </span>
                <button
                  type="button"
                  className="mini-icon-btn"
                  onClick={() => setQuickEditItem(null)}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    영어 단어 *
                  </label>
                  <input
                    type="text"
                    className="text-input"
                    style={{ width: '100%', fontSize: '0.95rem', fontWeight: 700 }}
                    value={quickEditWord}
                    onChange={(e) => setQuickEditWord(e.target.value)}
                    placeholder="단어 스펠링..."
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    발음 기호 (선택)
                  </label>
                  <input
                    type="text"
                    className="text-input"
                    style={{ width: '100%', fontSize: '0.85rem' }}
                    value={quickEditPhonetic}
                    onChange={(e) => setQuickEditPhonetic(e.target.value)}
                    placeholder="예: [həˈləʊ]"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    한국어 뜻 *
                  </label>
                  <input
                    type="text"
                    className="text-input"
                    style={{ width: '100%', fontSize: '0.9rem' }}
                    value={quickEditMeaning}
                    onChange={(e) => setQuickEditMeaning(e.target.value)}
                    placeholder="단어의 한글 뜻..."
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    영어 예문 (선택)
                  </label>
                  <textarea
                    className="text-input"
                    rows={3}
                    style={{ width: '100%', fontSize: '0.82rem', resize: 'vertical' }}
                    value={quickEditExample}
                    onChange={(e) => setQuickEditExample(e.target.value)}
                    placeholder="영어 예문 및 한글 해석..."
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ padding: '8px 16px' }}
                    onClick={() => setQuickEditItem(null)}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    style={{ padding: '8px 18px', fontWeight: 800 }}
                    onClick={handleSaveQuickEdit}
                  >
                    저장하기
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'study' && (
            <div className="study-main">
              {/* 특수 모드(벼락치기 또는 별표/취약 필터)가 켜져 있을 때만 슬림 배너 표시 */}
              {(isCramMode || studyFilter !== 'all') && (
                  <div className="active-mode-strip">
              <span>
                {isCramMode ? '⚡ 자유 복습(벼락치기) 진행 중 ' : ''}
                {studyFilter === 'starred'
                    ? '· ⭐ 별표 단어만 학습 중'
                    : studyFilter === 'weak'
                        ? '· 🔥 취약 단어만 학습 중'
                        : ''}
              </span>
                    <button
                        type="button"
                        className="secondary-btn"
                        style={{ padding: '4px 10px', fontSize: '0.72rem', background: '#ffffff' }}
                        onClick={() => {
                          if (isCramMode) exitCramMode();
                          setStudyFilter('all');
                        }}
                    >
                      해제
                    </button>
                  </div>
              )}

              {/* 메인 플래시카드 영역 */}
              {!currentItem ? (
                  <div className="done-card">
                    <div className="done-icon">
                      <Sparkles size={26} />
                    </div>
                    <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 800 }}>
                      [{studyCategory === 'ALL' ? '전체 단어장' : studyCategory.split('/').pop()}]{' '}
                      {isCramMode
                          ? '자유 복습 완료!'
                          : stats.todayReviewed >= dailyGoal
                          ? '오늘의 학습 목표 달성! 🎉'
                          : '오늘 할당된 단어 복습 완료!'}
                    </h2>
                    <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: 16 }}>
                      오늘 총 <strong>{stats.todayReviewed}회</strong> 복습 완료 (일일 목표: {dailyGoal}회
                      {todayNewStudiedCount > 0 ? ` · 오늘 새 단어: ${todayNewStudiedCount}개` : ''})
                    </p>
                    {totalDueInPool > 0 && dailyNewLimit > 0 && (
                      <div style={{
                        background: '#fefce8',
                        border: '1px solid #fef08a',
                        borderRadius: 14,
                        padding: '10px 14px',
                        marginBottom: 16,
                        fontSize: '0.82rem',
                        color: '#854d0e',
                        textAlign: 'center',
                        lineHeight: 1.5,
                      }}>
                        💡 오늘 할당된 새 단어({dailyNewLimit}개) 학습을 마쳤습니다. 대기 중인 단어가 <strong>{totalDueInPool}개</strong> 더 있습니다.
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {totalDueInPool > 0 && dailyNewLimit > 0 && (
                        <button
                          type="button"
                          className="submit-btn"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '10px 16px',
                            background: '#eab308',
                            color: '#0f172a',
                          }}
                          onClick={() => {
                            setDailyNewLimit((prev) => prev + 10);
                            showToast('⚡ 새 단어 10개가 오늘 대기열에 추가되었습니다!');
                          }}
                        >
                          <Plus size={15} />
                          새 단어 10개 더 공부하기
                        </button>
                      )}
                      {filteredPoolItems.length > 0 && (
                          <>
                            <button
                                type="button"
                                className="submit-btn"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '10px 16px' }}
                                onClick={() => startCramMode()}
                            >
                              <Zap size={15} />
                              자유 복습 ({filteredPoolItems.length}단어 더 보기)
                            </button>
                            <button
                                type="button"
                                className="submit-btn"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  padding: '10px 16px',
                                  background: '#0F172A',
                                  color: '#FFED00',
                                }}
                                onClick={startAutoPlay}
                            >
                              <PlayCircle size={15} />
                              ⚡ 깜빡이 암기 ({filteredPoolItems.length}단어 연속 듣기)
                            </button>
                          </>
                      )}
                      <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setShowGgModal(true)}
                      >
                        📁 다른 폴더 선택
                      </button>
                      {studyFilter !== 'all' && (
                          <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => setStudyFilter('all')}
                          >
                            필터 해제
                          </button>
                      )}
                    </div>
                  </div>
              ) : studyMode === 'flashcard' || studyMode === 'autoplay' ? (
                  <>
                    <div
                        className={`study-card clickable ${studyMode === 'flashcard' ? 'flashcard-card' : ''}`}
                        onClick={() => {
                          if (studyMode === 'autoplay') {
                            setIsAutoPlayPlaying((prev) => !prev);
                          } else {
                            setIsFlipped((prev) => !prev);
                          }
                        }}
                    >
                      {studyMode === 'autoplay' && !isAutoPlayPlaying && (
                          <div className="autoplay-pause-overlay">
                            <div className="autoplay-pause-tag">
                              <Pause size={14} /> 일시정지 (화면 터치 시 계속 재생)
                            </div>
                          </div>
                      )}
                      <div className="card-top-row">
                        <div className="card-badges-left">
                          <span
                              className="badge-state"
                              style={
                                studyMode === 'autoplay'
                                    ? { background: '#fef08a', color: '#854d0e', fontWeight: 800 }
                                    : undefined
                              }
                          >
                            {studyMode === 'autoplay'
                                ? `⚡ 깜빡이 (${autoPlayIndex + 1}/${autoPlayPool.length})`
                                : isCramMode
                                ? '⚡ 자유 복습'
                                : getStateLabel(currentItem.card.state)}
                          </span>
                          <button
                              type="button"
                              className="cat-badge"
                              title="클릭하여 다른 폴더 선택"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowGgModal(true);
                              }}
                          >
                            <FolderOpen size={12} />
                            {normalizeCategory(currentItem.tag)}
                          </button>
                          {isWeakItem(currentItem) && (
                              <span
                                  className="badge-state"
                                  style={{ background: '#ffedd5', color: '#c2410c' }}
                              >
                        🔥 취약
                      </span>
                          )}
                        </div>

                        <div className="card-actions-right">
                          <button
                              type="button"
                              className="pencil-circle-btn"
                              title="단어 오타 즉시 수정"
                              onClick={(e) => handleOpenQuickEdit(currentItem, e)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                              type="button"
                              className={`star-circle-btn ${currentItem.starred ? 'active' : ''}`}
                              title="별표(⭐) 체크/해제"
                              onClick={(e) => handleToggleStar(currentItem.id, e)}
                          >
                            <Star
                                size={18}
                                fill={currentItem.starred ? 'currentColor' : 'none'}
                            />
                          </button>
                          {/* 한→영 문제 화면(!isFlipped)에서는 스포일러 방지를 위해 우측 상단 스피커 숨김 (중앙 발음 힌트 버튼으로 일원화) */}
                          {(isFlipped || !isKoToEn) && (
                            <button
                                type="button"
                                className="icon-circle-btn"
                                title={
                                  isKoToEn
                                      ? '정답 단어 발음 듣기'
                                      : isFlipped
                                          ? '영어 예문 듣기'
                                          : '단어 발음 듣기'
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isKoToEn) {
                                    speakWord(currentItem.word, speechRate);
                                  } else if (isFlipped) {
                                    speakExampleOrWord(currentItem, speechRate);
                                  } else {
                                    speakWord(currentItem.word, speechRate);
                                  }
                                }}
                            >
                              <Volume2 size={19} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="card-center">
                        {!isKoToEn ? (
                            <>
                              <h2 className="word-display">{currentItem.word}</h2>
                              {currentItem.phonetic && (
                                  <div className="phonetic-display">{currentItem.phonetic}</div>
                              )}

                              {isFlipped && (
                                  <>
                                    <div className="meaning-display">{currentItem.meaning}</div>
                                    {currentItem.example && (
                                        <div className="example-wrapper">
                                          <div
                                              className="example-box"
                                              title="터치하면 영어 예문을 다시 읽어줍니다"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                speakExampleOrWord(currentItem, speechRate);
                                              }}
                                          >
                                            {currentItem.example}
                                          </div>
                                          <button
                                            type="button"
                                            className="example-tts-btn"
                                            title="영어 예문만 다시 듣기"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              speakExampleOrWord(currentItem, speechRate);
                                            }}
                                          >
                                            <Volume2 size={14} />
                                            <span>예문 듣기</span>
                                          </button>
                                        </div>
                                    )}
                                  </>
                              )}
                            </>
                        ) : !isFlipped ? (
                            <>
                              <div className="reverse-prompt-label">
                                한국어 뜻을 보고 영어 단어를 떠올려 보세요
                              </div>
                              <div className="meaning-display reverse-front">
                                {getSpellingPromptMeaning(currentItem.meaning, currentItem.word)}
                              </div>
                              {studyMode !== 'autoplay' && (
                                <div
                                    className="spelling-helpers"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                      type="button"
                                      className="helper-chip"
                                      onClick={() => speakWord(currentItem.word, speechRate)}
                                  >
                                    <Volume2 size={14} />
                                    발음 힌트
                                  </button>
                                  <button
                                      type="button"
                                      className="helper-chip"
                                      onClick={() => setShowHint((prev) => !prev)}
                                  >
                                    <HelpCircle size={14} />
                                    첫 글자 힌트
                                  </button>
                                </div>
                              )}
                              {studyMode !== 'autoplay' && showHint && (
                                  <div className="hint-text">
                                    {currentItem.word[0]}{' '}
                                    {'_ '.repeat(Math.max(0, currentItem.word.length - 1))} (
                                    {currentItem.word.length}글자)
                                  </div>
                              )}
                            </>
                        ) : (
                            <>
                              <h2
                                  className="word-display"
                                  title="터치하면 단어 발음을 다시 읽어줍니다"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    speakWord(currentItem.word, speechRate);
                                  }}
                              >
                                {currentItem.word}
                              </h2>
                              {currentItem.phonetic && (
                                  <div className="phonetic-display">{currentItem.phonetic}</div>
                              )}
                              <div className="meaning-display">{currentItem.meaning}</div>
                              {currentItem.example && (
                                  <div className="example-wrapper">
                                    <div
                                        className="example-box"
                                        title="터치하면 영어 예문을 읽어줍니다"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          speakExampleOrWord(currentItem, speechRate);
                                        }}
                                    >
                                      {currentItem.example}
                                    </div>
                                    <button
                                      type="button"
                                      className="example-tts-btn"
                                      title="영어 예문만 다시 듣기"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        speakExampleOrWord(currentItem, speechRate);
                                      }}
                                    >
                                      <Volume2 size={14} />
                                      <span>예문 듣기</span>
                                    </button>
                                  </div>
                              )}
                            </>
                        )}
                      </div>

                      <div className="flip-hint">
                        <RotateCcw size={13} />
                        {studyMode === 'autoplay'
                            ? isAutoPlayPlaying
                                ? '화면 터치 시 일시정지'
                                : '화면 터치 시 계속 재생'
                            : !isFlipped
                            ? isKoToEn
                                ? '카드를 터치하면 정답 영어 단어와 발음을 확인합니다'
                                : '카드를 터치하면 뜻과 함께 영어 예문을 읽어줍니다'
                            : '아래에서 기억 난이도를 선택해 주세요'}
                      </div>
                    </div>

                    {studyMode === 'autoplay' && (
                        <div className="autoplay-controller-card">
                          <div className="autoplay-top-status">
                            <div className="autoplay-status-badge">
                              <span className={`pulse-dot ${isAutoPlayPlaying ? 'active' : ''}`} />
                              <strong>
                                {isAutoPlayPlaying
                                    ? autoPlayPhase === 'front'
                                        ? '1단계: 문제 확인 중'
                                        : `2단계: 정답 확인${autoPlayRepeatCount > 1 ? ` (${autoPlayRepeatCount}회 반복)` : ''}`
                                    : '일시정지 중'}
                              </strong>
                              <span className="autoplay-phase-desc">
                                {isAutoPlayPlaying
                                    ? autoPlayPhase === 'front'
                                        ? `${autoPlayInterval}초 후 정답 화면으로 전환됩니다`
                                        : autoPlayRepeatCount > 1
                                            ? '답 1초 간격 반복 청취 후 다음 문제로 바로 이동합니다'
                                            : '답 읽기 완료 시 다음 문제로 바로 이동합니다'
                                    : '재생 버튼 또는 화면을 터치하세요'}
                              </span>
                            </div>
                            <div className="autoplay-progress-count">
                              {autoPlayIndex + 1} / {autoPlayPool.length}
                            </div>
                          </div>

                          <div className="autoplay-timer-track">
                            <div
                                key={`${autoPlayIndex}-${autoPlayPhase}-${isAutoPlayPlaying}`}
                                className={`autoplay-timer-bar ${isAutoPlayPlaying ? 'animating' : ''}`}
                                style={{
                                  animationDuration: `${autoPlayPhase === 'front' ? autoPlayInterval : 1.0}s`,
                                  width: isAutoPlayPlaying ? undefined : autoPlayPhase === 'front' ? '50%' : '100%',
                                }}
                            />
                          </div>

                          <div className="autoplay-controls-row">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                  type="button"
                                  className="autoplay-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAutoplayStep('prev');
                                  }}
                                  title="이전 단어 (←)"
                              >
                                <SkipBack size={15} />
                              </button>

                              <button
                                  type="button"
                                  className={`autoplay-main-play-btn ${isAutoPlayPlaying ? 'playing' : 'paused'}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsAutoPlayPlaying((prev) => !prev);
                                  }}
                              >
                                {isAutoPlayPlaying ? (
                                    <>
                                      <Pause size={15} />
                                      <span>일시정지</span>
                                    </>
                                ) : (
                                    <>
                                      <Play size={15} />
                                      <span>계속 재생</span>
                                    </>
                                )}
                              </button>

                              <button
                                  type="button"
                                  className="autoplay-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAutoplayStep('next');
                                  }}
                                  title="다음 단어 (→)"
                              >
                                <SkipForward size={15} />
                              </button>

                              <button
                                  type="button"
                                  className={`autoplay-btn ${isAutoPlayLoop ? 'active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsAutoPlayLoop((prev) => !prev);
                                  }}
                                  title={isAutoPlayLoop ? '전체 반복 켜짐' : '전체 반복 꺼짐'}
                              >
                                <Repeat size={14} />
                              </button>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div
                                  className="autoplay-select-wrapper"
                                  title="문제 노출 시간 선택 (1초~20초)"
                              >
                                <select
                                    className="autoplay-select-btn"
                                    value={autoPlayInterval}
                                    onChange={(e) => {
                                      handleUpdateAutoPlayInterval(Number(e.target.value));
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label="문제 노출 시간 선택"
                                >
                                  {AUTO_PLAY_INTERVAL_OPTIONS.map((sec) => (
                                      <option key={sec} value={sec}>
                                        {sec}초
                                      </option>
                                  ))}
                                </select>
                                <ChevronDown size={14} className="autoplay-select-arrow" />
                              </div>

                              <button
                                  type="button"
                                  className="autoplay-btn"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '7px 10px',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowAutoPlayOptionsModal(true);
                                  }}
                                  title="깜빡이 옵션 설정 (답 반복 횟수, 한글 음성 읽기 등)"
                              >
                                <Settings2 size={14} />
                                <span>옵션</span>
                              </button>

                              <button
                                  type="button"
                                  className="secondary-btn"
                                  style={{ padding: '6px 10px', fontSize: '0.74rem' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    exitAutoPlay();
                                  }}
                                  title="깜빡이 모드 종료"
                              >
                                종료
                              </button>
                            </div>
                          </div>
                        </div>
                    )}
                  </>
              ) : studyMode === 'cloze' ? (
                  <>
                    <div className="study-card">
                      <div className="card-top-row">
                        <div className="card-badges-left">
                          <span className="badge-state">
                            {isCramMode ? '⚡ 자유 복습' : getStateLabel(currentItem.card.state)}
                          </span>
                          <span
                              className="badge-state"
                              style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 800 }}
                          >
                            <Puzzle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                            예문 빈칸
                          </span>
                          <button
                              type="button"
                              className="cat-badge"
                              onClick={() => setShowGgModal(true)}
                          >
                            <FolderOpen size={12} />
                            {normalizeCategory(currentItem.tag)}
                          </button>
                          {isWeakItem(currentItem) && (
                              <span
                                  className="badge-state"
                                  style={{ background: '#ffedd5', color: '#c2410c' }}
                              >
                                🔥 취약
                              </span>
                          )}
                        </div>
                        <div className="card-actions-right">
                          <button
                              type="button"
                              className="pencil-circle-btn"
                              title="단어 오타 즉시 수정"
                              onClick={(e) => handleOpenQuickEdit(currentItem, e)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                              type="button"
                              className={`star-circle-btn ${currentItem.starred ? 'active' : ''}`}
                              title="별표(⭐) 체크/해제"
                              onClick={(e) => handleToggleStar(currentItem.id, e)}
                          >
                            <Star
                                size={18}
                                fill={currentItem.starred ? 'currentColor' : 'none'}
                            />
                          </button>
                          <button
                              type="button"
                              className="icon-circle-btn"
                              title="예문/발음 듣기"
                              onClick={() => speakExampleOrWord(currentItem, speechRate)}
                          >
                            <Volume2 size={19} />
                          </button>
                        </div>
                      </div>

                      <div className="card-center">
                        <div className="cloze-card-prompt">
                          <Sparkles size={13} />
                          문맥에 알맞은 영어 단어를 맞춰보세요
                        </div>

                        {currentClozeData && (
                          <>
                            <div className="cloze-sentence-display">
                              {currentClozeData.prefix}
                              {!isFlipped ? (
                                <span className="cloze-blank-box">[ _____ ]</span>
                              ) : (
                                <span className="cloze-revealed-word">{currentClozeData.matchedWord}</span>
                              )}
                              {currentClozeData.suffix}
                            </div>

                            <div className="cloze-translation-box">
                              <span className="cloze-ko-label">해석</span>
                              <span className="cloze-ko-text">{currentClozeData.koreanTranslation}</span>
                            </div>

                            {!isFlipped ? (
                              <>
                                <div className="spelling-helpers">
                                  <button
                                      type="button"
                                      className="helper-chip"
                                      onClick={() => speakWord(currentItem.word, speechRate)}
                                  >
                                    <Volume2 size={14} />
                                    발음 힌트
                                  </button>
                                  <button
                                      type="button"
                                      className="helper-chip"
                                      onClick={() => setShowHint((prev) => !prev)}
                                  >
                                    <HelpCircle size={14} />
                                    첫 글자 힌트
                                  </button>
                                </div>

                                {showHint && (
                                  <div className="hint-text">
                                    {currentClozeData.targetWord[0]}{' '}
                                    {'_ '.repeat(Math.max(0, currentClozeData.targetWord.length - 1))} (
                                    {currentClozeData.targetWord.length}글자)
                                  </div>
                                )}

                                <form className="cloze-form" onSubmit={handleCheckCloze}>
                                  <input
                                      ref={clozeInputRef}
                                      type="text"
                                      className="cloze-input"
                                      placeholder="빈칸에 들어갈 영어 단어 입력..."
                                      value={clozeInput}
                                      onChange={(e) => setClozeInput(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          submitClozeAnswer();
                                        }
                                      }}
                                      enterKeyHint="done"
                                      autoCapitalize="none"
                                      autoCorrect="off"
                                      spellCheck={false}
                                  />
                                  <button
                                      type="submit"
                                      className="submit-btn"
                                      onClick={handleCheckCloze}
                                  >
                                    확인
                                  </button>
                                </form>
                                <div className="cloze-skip-hint">
                                  💡 생각 후 입력 없이 바로 하단 [정답 확인하기 (Space)]를 눌러도 됩니다
                                </div>
                              </>
                            ) : (
                              <div className="cloze-detail-card">
                                {clozeResult && (
                                  <div className={`spelling-feedback ${clozeResult}`} style={{ margin: '0 0 12px 0' }}>
                                    <div className="feedback-badge">
                                      {clozeResult === 'correct' ? (
                                        <>
                                          <Check size={18} />
                                          정답입니다!
                                        </>
                                      ) : (
                                        <>
                                          <X size={18} />
                                          아쉬워요! 내가 쓴 답: &ldquo;{clozeInput}&rdquo;
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div className="cloze-word-head">
                                  <span className="cloze-word-title">{currentItem.word}</span>
                                  {currentItem.phonetic && (
                                    <span className="cloze-word-phonetic">{currentItem.phonetic}</span>
                                  )}
                                  <button
                                      type="button"
                                      className="icon-circle-btn"
                                      style={{ width: 28, height: 28, marginLeft: 'auto' }}
                                      onClick={() => speakWord(currentItem.word, speechRate)}
                                      title="단어 발음 듣기"
                                  >
                                    <Volume2 size={15} />
                                  </button>
                                </div>
                                <div className="cloze-revealed-meaning">
                                  {expandMeaningAbbreviations(currentItem.meaning)}
                                </div>
                                {currentItem.example && (
                                  <div className="example-wrapper">
                                    <div
                                        className="example-box"
                                        onClick={() => speakExampleOrWord(currentItem, speechRate)}
                                        title="클릭하여 전체 예문 다시 듣기"
                                    >
                                      {currentItem.example}
                                    </div>
                                    <button
                                      type="button"
                                      className="example-tts-btn"
                                      title="영어 예문만 다시 듣기"
                                      onClick={() => speakExampleOrWord(currentItem, speechRate)}
                                    >
                                      <Volume2 size={14} />
                                      <span>예문 듣기</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </>
              ) : (
                  <>
                    <div className="study-card spelling-card">
                      <div className="card-top-row">
                        <div className="card-badges-left">
                    <span className="badge-state">
                      {isCramMode ? '⚡ 자유 복습' : getStateLabel(currentItem.card.state)}
                    </span>
                          <button
                              type="button"
                              className="cat-badge"
                              onClick={() => setShowGgModal(true)}
                          >
                            <FolderOpen size={12} />
                            {normalizeCategory(currentItem.tag)}
                          </button>
                        </div>
                        <div className="card-actions-right">
                          <button
                              type="button"
                              className="pencil-circle-btn"
                              title="단어 오타 즉시 수정"
                              onClick={(e) => handleOpenQuickEdit(currentItem, e)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                              type="button"
                              className={`star-circle-btn ${currentItem.starred ? 'active' : ''}`}
                              title="별표(⭐) 체크/해제"
                              onClick={(e) => handleToggleStar(currentItem.id, e)}
                          >
                            <Star
                                size={18}
                                fill={currentItem.starred ? 'currentColor' : 'none'}
                            />
                          </button>
                          <button
                              type="button"
                              className="icon-circle-btn"
                              onClick={() =>
                                  spellingResult
                                      ? speakExampleOrWord(currentItem, speechRate)
                                      : speakWord(currentItem.word, speechRate)
                              }
                          >
                            <Volume2 size={19} />
                          </button>
                        </div>
                      </div>

                      <div className="card-center">
                        <div className="spelling-prompt-label">다음 뜻에 맞는 영어 스펠링을 입력하세요</div>
                        <div className="meaning-display">
                          {!spellingResult
                              ? getSpellingPromptMeaning(currentItem.meaning, currentItem.word)
                              : expandMeaningAbbreviations(currentItem.meaning)}
                        </div>

                        {!spellingResult && (
                            <div className="spelling-helpers">
                              <button
                                  type="button"
                                  className="helper-chip"
                                  onClick={() => speakWord(currentItem.word, speechRate)}
                              >
                                <Volume2 size={14} />
                                발음 힌트
                              </button>
                              <button
                                  type="button"
                                  className="helper-chip"
                                  onClick={() => setShowHint((prev) => !prev)}
                              >
                                <HelpCircle size={14} />
                                첫 글자 힌트
                              </button>
                            </div>
                        )}

                        {showHint && !spellingResult && (
                            <div className="hint-text">
                              {currentItem.word[0]}{' '}
                              {'_ '.repeat(Math.max(0, currentItem.word.length - 1))} (
                              {currentItem.word.length}글자)
                            </div>
                        )}

                        {!spellingResult ? (
                            <>
                              <div className="spelling-length-hint">
                                <span className="length-badge">{currentItem.word.length}글자</span>
                                <div className="length-slots">
                                  {currentItem.word.split('').map((_, idx) => (
                                    <span
                                      key={idx}
                                      className={`slot-char ${idx < typedAnswer.length ? 'filled' : ''}`}
                                    >
                                      {idx < typedAnswer.length ? typedAnswer[idx] : '_'}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              <form className="spelling-form" onSubmit={handleCheckSpelling}>
                                <input
                                    ref={spellingInputRef}
                                    type="text"
                                    className="spelling-input"
                                    placeholder="영어 단어 입력 후 엔터..."
                                    value={typedAnswer}
                                    onChange={(e) => setTypedAnswer(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        submitSpellingAnswer();
                                      }
                                    }}
                                    enterKeyHint="done"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                />
                                <button
                                    type="submit"
                                    className="submit-btn"
                                    onClick={handleCheckSpelling}
                                >
                                  확인
                                </button>
                              </form>
                            </>
                        ) : (
                            <div className={`spelling-feedback ${spellingResult}`}>
                              <div className="feedback-badge">
                                {spellingResult === 'correct' ? (
                                    <>
                                      <Check size={18} />
                                      정답입니다!
                                    </>
                                ) : (
                                    <>
                                      <X size={18} />
                                      스펠링을 다시 확인해 보세요
                                    </>
                                )}
                              </div>

                              {spellingResult === 'wrong' ? (
                                <div className="spelling-diff-box">
                                  <div className="diff-row">
                                    <span className="diff-title">내가 쓴 답:</span>
                                    <div className="diff-letters typed">
                                      {typedAnswer.trim().length === 0 ? (
                                        <span className="diff-empty">(미입력)</span>
                                      ) : (
                                        typedAnswer.split('').map((ch, idx) => {
                                          const targetCh = currentItem.word[idx];
                                          const isMatch = targetCh && ch.toLowerCase() === targetCh.toLowerCase();
                                          return (
                                            <span
                                              key={idx}
                                              className={`diff-letter ${isMatch ? 'match' : 'mismatch'}`}
                                              title={isMatch ? '일치' : `틀림 (정답: ${targetCh || '없음'})`}
                                            >
                                              {ch}
                                            </span>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                  <div className="diff-row">
                                    <span className="diff-title">정답 단어:</span>
                                    <div className="diff-letters target">
                                      {currentItem.word.split('').map((ch, idx) => {
                                        const typedCh = typedAnswer[idx];
                                        const isMatch = typedCh && typedCh.toLowerCase() === ch.toLowerCase();
                                        return (
                                          <span
                                            key={idx}
                                            className={`diff-letter ${isMatch ? 'match' : 'target-correct'}`}
                                          >
                                            {ch}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    {currentItem.phonetic && <span className="phonetic-display inline">{currentItem.phonetic}</span>}
                                  </div>
                                </div>
                              ) : (
                                <div className="answer-compare">
                                  정답: <strong>{currentItem.word}</strong>{' '}
                                  {currentItem.phonetic && <span>{currentItem.phonetic}</span>}
                                </div>
                              )}

                              {currentItem.example && (
                                  <div className="example-wrapper">
                                    <div
                                        className="example-box"
                                        onClick={() => speakExampleOrWord(currentItem, speechRate)}
                                    >
                                      {currentItem.example}
                                    </div>
                                    <button
                                      type="button"
                                      className="example-tts-btn"
                                      title="영어 예문만 다시 듣기"
                                      onClick={() => speakExampleOrWord(currentItem, speechRate)}
                                    >
                                      <Volume2 size={14} />
                                      <span>예문 듣기</span>
                                    </button>
                                  </div>
                              )}
                            </div>
                        )}
                      </div>
                    </div>
                  </>
              )}

              {/* 카드 하단: 꼭 필요한 버튼만 남긴 단 1줄의 슬림 컨트롤 바 */}
              <div className="sleek-control-bar">
                <div className="mode-switch">
                  <button
                      type="button"
                      className={`mode-btn ${studyMode === 'flashcard' ? 'active' : ''}`}
                      onClick={() => {
                        if (studyMode === 'autoplay') exitAutoPlay();
                        setStudyMode('flashcard');
                        resetCardInteraction();
                      }}
                  >
                    <Layers size={14} />
                    플래시카드
                  </button>
                  <button
                      type="button"
                      className={`mode-btn ${studyMode === 'cloze' ? 'active' : ''}`}
                      onClick={() => {
                        if (studyMode === 'autoplay') exitAutoPlay();
                        setStudyMode('cloze');
                        resetCardInteraction();
                      }}
                  >
                    <Puzzle size={14} />
                    예문 빈칸
                  </button>
                  <button
                      type="button"
                      className={`mode-btn ${studyMode === 'spelling' ? 'active' : ''}`}
                      onClick={() => {
                        if (studyMode === 'autoplay') exitAutoPlay();
                        setStudyMode('spelling');
                        resetCardInteraction();
                      }}
                  >
                    <Keyboard size={14} />
                    스펠링 테스트
                  </button>
                  <button
                      type="button"
                      className={`mode-btn ${studyMode === 'autoplay' ? 'active' : ''}`}
                      onClick={() => {
                        if (studyMode !== 'autoplay') {
                          startAutoPlay();
                        }
                      }}
                      title="화면을 터치하지 않고 자동으로 발음과 뜻을 듣는 깜빡이 모드"
                  >
                    <Zap size={14} />
                    깜빡이 암기
                  </button>
                </div>
                
                <div className="sleek-bar-right">
                  {studyMode !== 'autoplay' && (
                      <button
                          type="button"
                          className="sleek-action-btn"
                          disabled={undoStack.length === 0}
                          onClick={handleUndo}
                          title="방금 넘긴 카드 되돌리기 (단축키 Z)"
                      >
                        <Undo2 size={14} />
                        되돌리기
                      </button>
                  )}
                </div>
              </div>

              {/* 화면 최하단 고정 학습 액션 바 (Anki Mobile 스타일 - 위치 완벽 고정) */}
              {studyMode !== 'autoplay' && currentItem && (
                  <div className="study-fixed-dock">
                    <div className="study-fixed-dock-inner">
                      {(studyMode === 'flashcard' || studyMode === 'cloze') && !isFlipped ? (
                          <button
                              type="button"
                              className="dock-show-answer-btn"
                              onClick={() => {
                                setIsFlipped(true);
                                if (studyMode === 'cloze') {
                                  speakExampleOrWord(currentItem, speechRate);
                                }
                              }}
                              title="정답 확인 (단축키: 스페이스바)"
                          >
                            <RotateCcw size={20} />
                            <span>정답 확인하기</span>
                            <span className="dock-key-tag">Space</span>
                          </button>
                      ) : (studyMode === 'flashcard' && isFlipped) ||
                          (studyMode === 'cloze' && (isFlipped || clozeResult !== null)) ||
                          (studyMode === 'spelling' && spellingResult) ? (
                          <div className="rating-grid">
                            {ratingOptions.map((opt) => (
                                <button
                                    key={opt.grade}
                                    type="button"
                                    className={`rate-btn ${opt.className}`}
                                    onClick={() => handleRate(opt.grade)}
                                >
                                  <span className="rate-label">{opt.label}</span>
                                  <span className="rate-interval">{opt.intervalText}</span>
                                </button>
                            ))}
                          </div>
                      ) : null}
                    </div>
                  </div>
              )}
            </div>
        )}

        {activeTab === 'add' && (
            <div className="panel-card">
              <div className="category-select-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="field-label">
                📁 책 제목 또는 상위/하위 폴더 (큰 제목 페이지 기준 자동 묶음)
              </span>
                  <button
                      type="button"
                      className="helper-chip"
                      onClick={() => setShowGgModal(true)}
                  >
                    폴더 목록 관리
                  </button>
                </div>
                <input
                    type="text"
                    className="text-input"
                    placeholder="예: Vocabulary Engine"
                    value={targetCategory}
                    onChange={(e) => setTargetCategory(e.target.value)}
                    list="folder-suggestions"
                />
                <datalist id="folder-suggestions">
                  {allCategories.map((cat) => (
                      <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              <div className="sub-tabs-3">
                <button
                    type="button"
                    className={`sub-tab-btn ${addSubTab === 'camera' ? 'active' : ''}`}
                    onClick={() => setAddSubTab('camera')}
                >
                  사진 스캔
                </button>
                <button
                    type="button"
                    className={`sub-tab-btn ${addSubTab === 'single' ? 'active' : ''}`}
                    onClick={() => setAddSubTab('single')}
                >
                  1개씩 추가
                </button>
                <button
                    type="button"
                    className={`sub-tab-btn ${addSubTab === 'excel' ? 'active' : ''}`}
                    onClick={() => {
                      setAddSubTab('excel');
                      setShowExcelModal(true);
                    }}
                >
                  엑셀 파일로 추가
                </button>
              </div>

              {addSubTab === 'camera' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                  {geminiApiKey ? 'Gemini AI 연결됨' : 'API 키 설정 필요'}
                </span>
                      <button
                          type="button"
                          className="helper-chip"
                          onClick={() => setShowApiKeyEditor((prev) => !prev)}
                      >
                        <KeyRound size={12} />
                        API 키 설정
                      </button>
                    </div>

                    {showApiKeyEditor && (
                        <div className="api-key-box">
                          <div className="api-key-row">
                            <input
                                type="password"
                                className="mini-input"
                                style={{ flex: 1 }}
                                placeholder="AIzaSy..."
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                            />
                            <button type="button" className="submit-btn" onClick={handleSaveApiKey}>
                              저장
                            </button>
                          </div>
                        </div>
                    )}

                    <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handlePhotosSelected}
                    />

                    <button
                        type="button"
                        className="camera-dropzone"
                        disabled={isExtracting}
                        onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera size={26} />
                      <span>단어장 사진 순서대로 선택 (큰 제목 페이지 기준 자동 묶음)</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.85 }}>
                  Unit 큰 제목이 있는 페이지부터 다음 큰 제목이 나오기 전까지 같은 유닛으로 묶입니다
                </span>
                    </button>

                    {isExtracting && (
                        <div className="ocr-loading">
                          <Loader2 size={18} className="spin" />
                          AI가 페이지 순서대로 큰 제목(Unit)을 판별해 단어를 묶고 있습니다...
                        </div>
                    )}

                    {ocrError && <div className="ocr-error">{ocrError}</div>}

                    {extractedDrafts.length > 0 && (
                        <>
                          <div className="draft-list">
                            {extractedDrafts.map((draft) => (
                                <div
                                    key={draft.id}
                                    className={`draft-row ${draft.selected ? '' : 'unselected'}`}
                                >
                                  <button
                                      type="button"
                                      className="draft-check-btn"
                                      onClick={() =>
                                          handleUpdateDraft(draft.id, 'selected', !draft.selected)
                                      }
                                  >
                                    {draft.selected ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <div className="draft-inputs">
                                    <div className="draft-input-grid">
                                      <input
                                          type="text"
                                          className="mini-input"
                                          value={draft.word}
                                          placeholder="단어"
                                          onChange={(e) =>
                                              handleUpdateDraft(draft.id, 'word', e.target.value)
                                          }
                                      />
                                      <input
                                          type="text"
                                          className="mini-input"
                                          value={draft.unit || ''}
                                          placeholder="하위 유닛 (예: Unit 10)"
                                          onChange={(e) =>
                                              handleUpdateDraft(draft.id, 'unit', e.target.value)
                                          }
                                      />
                                    </div>
                                    <input
                                        type="text"
                                        className="mini-input"
                                        value={draft.phonetic}
                                        placeholder="발음기호"
                                        onChange={(e) =>
                                            handleUpdateDraft(draft.id, 'phonetic', e.target.value)
                                        }
                                    />
                                    <textarea
                                        className="mini-input"
                                        rows={2}
                                        value={draft.meaning}
                                        onChange={(e) =>
                                            handleUpdateDraft(draft.id, 'meaning', e.target.value)
                                        }
                                    />
                                    <textarea
                                        className="mini-input"
                                        rows={2}
                                        value={draft.example}
                                        onChange={(e) =>
                                            handleUpdateDraft(draft.id, 'example', e.target.value)
                                        }
                                    />
                                  </div>
                                </div>
                            ))}
                          </div>
                          <button
                              type="button"
                              className="primary-full-btn"
                              onClick={handleSaveExtractedDrafts}
                          >
                            유닛별 하위 폴더로 분리하여 저장
                          </button>
                        </>
                    )}
                  </>
              )}

              {addSubTab === 'single' && (
                  <form
                      onSubmit={handleAddSingle}
                      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                  >
                    <div className="draft-input-grid">
                      <input
                          type="text"
                          className="text-input"
                          placeholder="영어 단어 (예: early)"
                          value={newWord}
                          onChange={(e) => setNewWord(e.target.value)}
                          required
                      />
                      <input
                          type="text"
                          className="text-input"
                          placeholder="발음기호 (예: [ə́ːrli])"
                          value={newPhonetic}
                          onChange={(e) => setNewPhonetic(e.target.value)}
                      />
                    </div>
                    <textarea
                        className="bulk-textarea"
                        placeholder="한국어 뜻 / 반대어 / 파생어"
                        value={newMeaning}
                        onChange={(e) => setNewMeaning(e.target.value)}
                        required
                    />
                    <textarea
                        className="bulk-textarea"
                        placeholder="예문 및 한글 번역"
                        value={newExample}
                        onChange={(e) => setNewExample(e.target.value)}
                    />
                    <button type="submit" className="primary-full-btn">
                      [{normalizeCategory(targetCategory)}]에 추가하기
                    </button>
                  </form>
              )}

              {addSubTab === 'excel' && (
                  <div className="excel-tab-card">
                    <div className="excel-tab-icon">
                      <FileSpreadsheet size={28} />
                    </div>
                    <h3 className="excel-tab-title">엑셀 파일로 단어 일괄 등록</h3>
                    <p className="excel-tab-desc">
                      대량의 단어를 엑셀(<code>.xlsx</code>, <code>.xls</code>, <code>.csv</code>) 파일로 한 번에 등록하고 자동 유닛 분류 및 FSRS 망각곡선 복습에 추가합니다.
                    </p>
                    <div className="excel-tab-actions">
                      <button
                          type="button"
                          className="submit-btn"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px' }}
                          onClick={() => setShowExcelModal(true)}
                      >
                        <FileSpreadsheet size={16} />
                        엑셀 등록 팝업창 열기
                      </button>
                      <button
                          type="button"
                          className="secondary-btn"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          onClick={downloadSampleExcelFile}
                      >
                        <Download size={14} />
                        샘플 엑셀 양식 다운로드
                      </button>
                    </div>
                  </div>
              )}
            </div>
        )}

        {activeTab === 'list' && (
            <div className="panel-card">
              <div className="list-folder-tree-box">
                <div className="folder-sidebar-header">
              <span className="folder-sidebar-title">
                <FolderOpen size={15} />
                문제집 폴더 목록 (클릭하여 조회 · ▲/▼ 위치 이동 · ✏️ 이름 수정)
              </span>
                  <button
                      type="button"
                      className="helper-chip"
                      style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                      onClick={() => setShowGgModal(true)}
                  >
                    + 새 폴더
                  </button>
                </div>

                <div className="folder-list">
                  <div className="folder-item-wrap">
                    <button
                        type="button"
                        className={`folder-item ${listCategory === 'ALL' ? 'active' : ''}`}
                        onClick={() => setListCategory('ALL')}
                    >
                  <span className="folder-item-left">
                    <FolderOpen size={15} />
                    <span className="folder-name">전체 단어장</span>
                  </span>
                      <span className="folder-count">{items.length}단어</span>
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, margin: '4px 0 8px' }}>
                    <button
                        type="button"
                        className="helper-chip"
                        style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                        onClick={handleCollapseAll}
                    >
                      모두 접기
                    </button>
                    <button
                        type="button"
                        className="helper-chip"
                        style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                        onClick={handleExpandAll}
                    >
                      모두 펼치기
                    </button>
                  </div>

                  {categoryTree.map((node, nIdx) =>
                    renderCategoryNode(node, false, categoryTree, nIdx)
                  )}
                </div>
              </div>

              <div className="backup-bar">
                <button type="button" className="backup-btn" onClick={handleExportJson}>
                  <Download size={15} />
                  백업 내보내기 (JSON)
                </button>
                <button
                    type="button"
                    className="backup-btn"
                    onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={15} />
                  백업 불러오기
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={handleImportFile}
                />
              </div>

              <div className="filter-chip-group">
                <button
                    type="button"
                    className={`filter-chip ${studyFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setStudyFilter('all')}
                >
                  전체 보기
                </button>
                <button
                    type="button"
                    className={`filter-chip star ${studyFilter === 'starred' ? 'active' : ''}`}
                    onClick={() => setStudyFilter('starred')}
                >
                  <Star size={13} fill={studyFilter === 'starred' ? 'currentColor' : 'none'} />
                  별표 단어 ({items.filter((it) => isCategoryMatch(it.tag, listCategory) && it.starred).length})
                </button>
                <button
                    type="button"
                    className={`filter-chip weak ${studyFilter === 'weak' ? 'active' : ''}`}
                    onClick={() => setStudyFilter('weak')}
                >
                  <Flame size={13} />
                  취약 단어 ({items.filter((it) => isCategoryMatch(it.tag, listCategory) && isWeakItem(it)).length})
                </button>
              </div>

              <div className="search-box">
                <Search size={16} />
                <input
                    type="text"
                    className="search-input"
                    placeholder={`[${listCategory === 'ALL' ? '전체 단어장' : listCategory}] 내 단어, 뜻, 예문 검색...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="word-list">
                {filteredList.map((item) => (
                    <div key={item.id} className="word-row">
                      {editingId === item.id ? (
                          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <input
                                type="text"
                                className="text-input"
                                value={editTag}
                                onChange={(e) => setEditTag(e.target.value)}
                                placeholder="상위폴더/하위폴더"
                            />
                            <div className="draft-input-grid">
                              <input
                                  type="text"
                                  className="text-input"
                                  value={editWord}
                                  onChange={(e) => setEditWord(e.target.value)}
                              />
                              <input
                                  type="text"
                                  className="text-input"
                                  value={editPhonetic}
                                  onChange={(e) => setEditPhonetic(e.target.value)}
                              />
                            </div>
                            <textarea
                                className="bulk-textarea"
                                value={editMeaning}
                                onChange={(e) => setEditMeaning(e.target.value)}
                            />
                            <textarea
                                className="bulk-textarea"
                                value={editExample}
                                onChange={(e) => setEditExample(e.target.value)}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                              <button
                                  type="button"
                                  className="secondary-btn"
                                  onClick={() => setEditingId(null)}
                              >
                                취소
                              </button>
                              <button
                                  type="button"
                                  className="submit-btn"
                                  onClick={() => {
                                    const norm = normalizeCategory(editTag);
                                    const nextCats = Array.from(new Set([...allCategories, norm]));
                                    const nextItems = items.map((it) =>
                                        it.id === item.id
                                            ? {
                                              ...it,
                                              word: editWord.trim(),
                                              phonetic: editPhonetic.trim() || undefined,
                                              meaning: expandMeaningAbbreviations(editMeaning),
                                              example: editExample.trim() || undefined,
                                              tag: norm,
                                            }
                                            : it
                                    );
                                    setCustomCategories(nextCats);
                                    setItems(nextItems);
                                    setEditingId(null);
                                    scheduleCloudPush(nextItems, nextCats, stats);
                                    showToast('단어가 수정되었습니다.');
                                  }}
                              >
                                저장
                              </button>
                            </div>
                          </div>
                      ) : (
                          <>
                            <div className="word-row-main">
                              <div className="word-row-title">
                                <span>{item.word}</span>
                                {item.phonetic && (
                                    <span className="word-row-phonetic">{item.phonetic}</span>
                                )}
                                <span className="cat-badge">{normalizeCategory(item.tag)}</span>
                                {isWeakItem(item) && (
                                    <span
                                        className="badge-state"
                                        style={{ background: '#ffedd5', color: '#c2410c' }}
                                    >
                            🔥 취약
                          </span>
                                )}
                              </div>
                              <div className="word-row-meaning">{item.meaning}</div>
                              {item.example && (
                                  <div
                                      className="word-row-example"
                                      style={{ cursor: 'pointer' }}
                                      title="터치하면 영어 예문을 읽어줍니다"
                                      onClick={() => speakExampleOrWord(item, speechRate)}
                                  >
                                    {item.example}
                                  </div>
                              )}
                              <div className="word-row-meta">
                                복습 횟수:{' '}
                                {(item.itemStats?.wins || 0) + (item.itemStats?.losses || 0)}회 · 다음
                                복습:{' '}
                                {item.card.due.toLocaleDateString('ko-KR', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </div>
                            </div>
                            <div className="row-actions">
                              <button
                                  type="button"
                                  className={`mini-icon-btn ${item.starred ? 'star-active' : ''}`}
                                  title="별표(⭐) 체크/해제"
                                  onClick={() => handleToggleStar(item.id)}
                              >
                                <Star size={15} fill={item.starred ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                  type="button"
                                  className="mini-icon-btn"
                                  title="단어 발음 듣기"
                                  onClick={() => speakWord(item.word, speechRate)}
                              >
                                <Volume2 size={15} />
                              </button>
                              <button
                                  type="button"
                                  className="mini-icon-btn"
                                  title="단어 수정"
                                  onClick={() => {
                                    setEditingId(item.id);
                                    setEditWord(item.word);
                                    setEditPhonetic(item.phonetic ?? '');
                                    setEditMeaning(item.meaning);
                                    setEditExample(item.example ?? '');
                                    setEditTag(normalizeCategory(item.tag));
                                  }}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                  type="button"
                                  className="mini-icon-btn danger"
                                  title="단어 삭제"
                                  onClick={() => handleDeleteItem(item)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </>
                      )}
                    </div>
                ))}
              </div>
            </div>
        )}

        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            <button
                type="button"
                className={`nav-item ${activeTab === 'study' ? 'active' : ''}`}
                onClick={() => setActiveTab('study')}
            >
              <BookOpen size={19} />
              학습하기 ({dueItems.length})
            </button>
            <button
                type="button"
                className={`nav-item ${activeTab === 'add' ? 'active' : ''}`}
                onClick={() => setActiveTab('add')}
            >
              <Plus size={19} />
              단어 추가
            </button>
            <button
                type="button"
                className={`nav-item ${activeTab === 'list' ? 'active' : ''}`}
                onClick={() => setActiveTab('list')}
            >
              <List size={19} />
              단어 목록
            </button>
          </div>
        </nav>
      </div>
  );
}

export default App;
