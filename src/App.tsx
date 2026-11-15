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
  PanelLeftClose,
  PanelLeftOpen,
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
  expandMeaningAbbreviations,
  getSpellingPromptMeaning,
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

interface FolderTreeNode {
  parent: string;
  children: Array<{ fullPath: string; childName: string }>;
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

const SPEECH_RATES = [0.5, 0.7, 0.8, 0.9, 1.0];
const SPEECH_RATE_STORAGE_KEY = 'soi_vocab_speech_rate_v1';

function formatInterval(due: Date, now: Date): string {
  const diffMs = Math.max(0, due.getTime() - now.getTime());
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return '오늘 재복습';
  if (diffMin < 60) return `${diffMin}분 뒤`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}시간 뒤`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}일 뒤`;
  return `${Math.round(diffDays / 30)}개월 뒤`;
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
  const [studyMode, setStudyMode] = useState<StudyMode>('flashcard');
  const [studyFilter, setStudyFilter] = useState<StudyFilter>('all');
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [speechRate, setSpeechRate] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SPEECH_RATE_STORAGE_KEY));
    return SPEECH_RATES.includes(saved) ? saved : 0.9;
  });
  const speechRateRef = useRef<number>(speechRate);
  const speechTimeoutRef = useRef<number | null>(null);
  const cloudPushTimerRef = useRef<number | null>(null);

  // 안키 보조 기능: 자유 복습(벼락치기) 모드 및 실행 취소(Undo) 스택
  const [isCramMode, setIsCramMode] = useState<boolean>(false);
  const [cramQueueIds, setCramQueueIds] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);

  const [isFolderSidebarOpen, setIsFolderSidebarOpen] = useState<boolean>(false);
  const [showBottomStats, setShowBottomStats] = useState<boolean>(false);
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>({});

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
      null
  );

  const [studyCategory, setStudyCategory] = useState<string>('ALL');
  const [listCategory, setListCategory] = useState<string>('ALL');
  const [targetCategory, setTargetCategory] = useState<string>('Vocabulary Engine');
  const [showGgModal, setShowGgModal] = useState<boolean>(false);
  const [newParentFolder, setNewParentFolder] = useState<string>('');
  const [newChildFolder, setNewChildFolder] = useState<string>('');

  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [typedAnswer, setTypedAnswer] = useState<string>('');
  const [spellingResult, setSpellingResult] = useState<'correct' | 'wrong' | null>(null);
  const [showHint, setShowHint] = useState<boolean>(false);
  const cardStartTimeRef = useRef<number>(Date.now());
  const spellingInputRef = useRef<HTMLInputElement | null>(null);

  const [addSubTab, setAddSubTab] = useState<'camera' | 'single' | 'bulk'>('camera');
  const [newWord, setNewWord] = useState<string>('');
  const [newPhonetic, setNewPhonetic] = useState<string>('');
  const [newMeaning, setNewMeaning] = useState<string>('');
  const [newExample, setNewExample] = useState<string>('');
  const [bulkText, setBulkText] = useState<string>('');
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
  const [showNasConfig, setShowNasConfig] = useState<boolean>(false);
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

  const folderTree = useMemo<FolderTreeNode[]>(() => {
    const map = new Map<string, Array<{ fullPath: string; childName: string }>>();
    allCategories.forEach((path) => {
      const parts = path.split('/');
      const parent = parts[0].trim();
      const childName = parts.slice(1).join('/').trim();
      if (!map.has(parent)) map.set(parent, []);
      if (childName) {
        map.get(parent)!.push({ fullPath: path, childName });
      }
    });
    return Array.from(map.entries()).map(([parent, children]) => ({
      parent,
      children,
    }));
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

  // 일반 FSRS 복습 대기열 vs 자유 복습(벼락치기) 대기열
  const dueItems = useMemo(() => {
    if (isCramMode) {
      const itemMap = new Map(filteredPoolItems.map((it) => [it.id, it]));
      return cramQueueIds
          .map((id) => itemMap.get(id))
          .filter((it): it is VocabItem => !!it);
    }

    const endOfToday = new Date().setHours(23, 59, 59, 999);
    const list = filteredPoolItems.filter((item) => item.card.due.getTime() <= endOfToday);

    return [...list].sort((a, b) => {
      const aLast = a.itemStats?.lastSolvedAt || 0;
      const bLast = b.itemStats?.lastSolvedAt || 0;
      if (aLast !== bLast) {
        return aLast - bLast;
      }
      return a.card.due.getTime() - b.card.due.getTime();
    });
  }, [filteredPoolItems, isCramMode, cramQueueIds]);

  const currentItem = dueItems[0] ?? null;

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

  useEffect(() => {
    if (activeTab !== 'study' || studyMode !== 'flashcard' || !autoSpeak || !currentItem) {
      return;
    }
    if (!isFlipped) {
      speakWord(currentItem.word, speechRate);
    } else {
      speakExampleOrWord(currentItem, speechRate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, studyMode, autoSpeak, currentItem?.id, isFlipped]);

  useEffect(() => {
    if (activeTab === 'study' && studyMode === 'spelling' && currentItem && !spellingResult) {
      spellingInputRef.current?.focus();
    }
  }, [activeTab, studyMode, currentItem?.id, spellingResult]);

  const resetCardInteraction = () => {
    setIsFlipped(false);
    setTypedAnswer('');
    setSpellingResult(null);
    setShowHint(false);
    cardStartTimeRef.current = Date.now();
  };

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
    resetCardInteraction();
    scheduleCloudPush(lastSnap.items, allCategories, lastSnap.stats);
    showToast(`↩️ "${lastSnap.wordLabel}" 카드로 되돌렸습니다.`);
  };

  const handleMoveParentFolder = (parentName: string, direction: 'up' | 'down') => {
    const idx = folderTree.findIndex((g) => g.parent === parentName);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= folderTree.length) return;

    const nextTree = [...folderTree];
    const temp = nextTree[idx];
    nextTree[idx] = nextTree[swapIdx];
    nextTree[swapIdx] = temp;

    const nextCategories: string[] = [];
    nextTree.forEach((group) => {
      if (group.children.length === 0) {
        nextCategories.push(group.parent);
      } else {
        if (allCategories.includes(group.parent)) {
          nextCategories.push(group.parent);
        }
        group.children.forEach((ch) => nextCategories.push(ch.fullPath));
      }
    });

    setCustomCategories(nextCategories);
    scheduleCloudPush(items, nextCategories, stats);
  };

  const handleMoveChildFolder = (
      parentName: string,
      fullPath: string,
      direction: 'up' | 'down'
  ) => {
    const groupIdx = folderTree.findIndex((g) => g.parent === parentName);
    if (groupIdx < 0) return;
    const children = [...folderTree[groupIdx].children];
    const cIdx = children.findIndex((c) => c.fullPath === fullPath);
    if (cIdx < 0) return;
    const swapIdx = direction === 'up' ? cIdx - 1 : cIdx + 1;
    if (swapIdx < 0 || swapIdx >= children.length) return;

    const temp = children[cIdx];
    children[cIdx] = children[swapIdx];
    children[swapIdx] = temp;

    const nextTree = folderTree.map((g, i) =>
        i === groupIdx ? { ...g, children } : g
    );

    const nextCategories: string[] = [];
    nextTree.forEach((group) => {
      if (group.children.length === 0) {
        nextCategories.push(group.parent);
      } else {
        if (allCategories.includes(group.parent)) {
          nextCategories.push(group.parent);
        }
        group.children.forEach((ch) => nextCategories.push(ch.fullPath));
      }
    });

    setCustomCategories(nextCategories);
    scheduleCloudPush(items, nextCategories, stats);
  };

  const handleAddFolderHierarchy = () => {
    const p = formatFolderSegment(newParentFolder.replace(/\//g, ' '));
    const c = formatFolderSegment(newChildFolder.replace(/\//g, ' '));
    if (!p && !c) return;
    const fullPath = p && c ? `${p}/${c}` : p || c;
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
        `[${parentName}] 상위 폴더 아래에 만들 하위 폴더(유닛) 이름을 입력하세요:`,
        'Unit 01'
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
        (studyMode !== 'spelling' || spellingResult === 'correct');

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

      // Space: 플래시카드 뒤집기
      if (e.code === 'Space' && studyMode === 'flashcard' && !isFlipped) {
        e.preventDefault();
        setIsFlipped(true);
        return;
      }

      // 1, 2, 3, 4: 카드 평가 (뒷면이거나 스펠링 채점 완료 상태일 때)
      const canRate =
          (studyMode === 'flashcard' && isFlipped) ||
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
        if (isFlipped || spellingResult) {
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
    setShowNasConfig(false);
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

  const handleAddBulk = () => {
    const lines = bulkText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length === 0) return;

    const normFolder = normalizeCategory(targetCategory);
    const added: VocabItem[] = [];
    const nowTs = Date.now();

    lines.forEach((line, idx) => {
      const [mainPart, examplePart] = line.split('|').map((p) => p.trim());
      const match = mainPart.match(/^(.+?)(?:\t|\s+-\s+|\s*[:=]\s*|\s*,\s*)(.+)$/);
      if (match) {
        added.push(
            createNewVocabItem(
                match[1].trim(),
                match[2].trim(),
                examplePart,
                new Date(nowTs + idx),
                normFolder
            )
        );
      }
    });

    if (added.length === 0) {
      showToast('인식된 단어가 없습니다. "단어 - 뜻" 형식을 확인해 주세요.');
      return;
    }
    const nextCats = Array.from(new Set([...allCategories, normFolder]));
    const nextItems = [...added, ...items];
    setCustomCategories(nextCats);
    setItems(nextItems);
    setBulkText('');
    scheduleCloudPush(nextItems, nextCats, stats);
    showToast(`[${normFolder}]에 ${added.length}개 단어가 등록되었습니다.`);
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
          intervalText: isCramMode ? '세션 끝 재복습' : '오늘 끝부분 재복습',
        },
        {
          grade: Rating.Hard,
          label: '어려움 (2)',
          className: 'rate-hard',
          intervalText: isCramMode ? '세션 끝 재복습' : '오늘 끝부분 재복습',
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
        <header className="app-header">
          <div>
            <h1 className="app-title">소이의 단어 암기장</h1>
            <p className="app-subtitle">전체 {items.length}단어 · FSRS 망각곡선 단어장</p>
          </div>
        </header>

        {toastMsg && <div className="toast-banner">{toastMsg}</div>}

        {/* 폴더 목록 & 순서/이름/통계 관리 모달 */}
        {showGgModal && (
            <div className="gg-modal-backdrop" onClick={() => setShowGgModal(false)}>
              <div className="gg-modal" onClick={(e) => e.stopPropagation()}>
                <div className="gg-modal-header">
              <span className="gg-modal-title">
                ⚙️ 문제집 폴더 위치 · 이름 · 통계 관리
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
                  <div className="gg-box-title">
                    문제집 폴더 목록 (▲/▼ 버튼으로 위치 변경 · ✏️ 버튼으로 이름/상위폴더 수정)
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                        type="text"
                        className="mini-input"
                        placeholder="상위 폴더 (예: Vocabulary Engine)"
                        value={newParentFolder}
                        onChange={(e) => setNewParentFolder(e.target.value)}
                    />
                    <input
                        type="text"
                        className="mini-input"
                        placeholder="하위 폴더 (예: Unit 10)"
                        value={newChildFolder}
                        onChange={(e) => setNewChildFolder(e.target.value)}
                    />
                    <button
                        type="button"
                        className="submit-btn"
                        style={{ whiteSpace: 'nowrap', padding: '0 10px' }}
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
                          onClick={() => setStudyCategory('ALL')}
                      >
                    <span className="folder-item-left">
                      <FolderOpen size={15} />
                      <span className="folder-name">전체 단어장 (All Problems)</span>
                    </span>
                        <span className="folder-count">
                      {allCounts.due}/{allCounts.total}
                    </span>
                      </button>
                    </div>

                    {folderTree.map((group, gIdx) => {
                      const parentCounts = getFolderCounts(group.parent);
                      const isParentSelected = studyCategory === group.parent;
                      return (
                          <div key={group.parent} className="folder-tree-group">
                            <div className="folder-item-wrap">
                              <button
                                  type="button"
                                  className={`folder-item ${isParentSelected ? 'active' : ''}`}
                                  onClick={() => {
                                    setStudyCategory(group.parent);
                                    setTargetCategory(group.parent);
                                  }}
                              >
                          <span className="folder-item-left">
                            <FolderOpen size={15} />
                            <span className="folder-name">★ {group.parent}</span>
                          </span>
                                <span className="folder-count">
                            {parentCounts.due}/{parentCounts.total}
                          </span>
                              </button>
                              <button
                                  type="button"
                                  className="folder-action-btn"
                                  title="위로 이동"
                                  disabled={gIdx === 0}
                                  onClick={() => handleMoveParentFolder(group.parent, 'up')}
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                  type="button"
                                  className="folder-action-btn"
                                  title="아래로 이동"
                                  disabled={gIdx === folderTree.length - 1}
                                  onClick={() => handleMoveParentFolder(group.parent, 'down')}
                              >
                                <ArrowDown size={13} />
                              </button>
                              <button
                                  type="button"
                                  className="folder-action-btn"
                                  title="하위 유닛 추가"
                                  onClick={() => handleQuickAddSubfolder(group.parent)}
                              >
                                <Plus size={13} />
                              </button>
                              <button
                                  type="button"
                                  className="folder-action-btn"
                                  title="폴더 이름 변경"
                                  onClick={() => handleRenameFolder(group.parent)}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                  type="button"
                                  className="folder-action-btn danger"
                                  title="폴더 삭제"
                                  onClick={() => handleDeleteCategory(group.parent)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>

                            {group.children.length > 0 && (
                                <div className="folder-sub-list">
                                  {group.children.map((child, cIdx) => {
                                    const childCounts = getFolderCounts(child.fullPath);
                                    const isChildSelected = studyCategory === child.fullPath;
                                    return (
                                        <div key={child.fullPath} className="folder-item-wrap">
                                          <button
                                              type="button"
                                              className={`folder-item ${isChildSelected ? 'active' : ''}`}
                                              onClick={() => {
                                                setStudyCategory(child.fullPath);
                                                setTargetCategory(child.fullPath);
                                              }}
                                          >
                                  <span className="folder-item-left">
                                    <Folder size={13} />
                                    <span className="folder-name">{child.childName}</span>
                                  </span>
                                            <span className="folder-count">
                                    {childCounts.due}/{childCounts.total}
                                  </span>
                                          </button>
                                          <button
                                              type="button"
                                              className="folder-action-btn"
                                              title="위로 이동"
                                              disabled={cIdx === 0}
                                              onClick={() =>
                                                  handleMoveChildFolder(group.parent, child.fullPath, 'up')
                                              }
                                          >
                                            <ArrowUp size={12} />
                                          </button>
                                          <button
                                              type="button"
                                              className="folder-action-btn"
                                              title="아래로 이동"
                                              disabled={cIdx === group.children.length - 1}
                                              onClick={() =>
                                                  handleMoveChildFolder(
                                                      group.parent,
                                                      child.fullPath,
                                                      'down'
                                                  )
                                              }
                                          >
                                            <ArrowDown size={12} />
                                          </button>
                                          <button
                                              type="button"
                                              className="folder-action-btn"
                                              title="유닛 이름/경로 변경"
                                              onClick={() => handleRenameFolder(child.fullPath)}
                                          >
                                            <Pencil size={12} />
                                          </button>
                                          <button
                                              type="button"
                                              className="folder-action-btn danger"
                                              title="유닛 삭제"
                                              onClick={() => handleDeleteCategory(child.fullPath)}
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                    );
                                  })}
                                </div>
                            )}
                          </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className="secondary-btn"
                        onClick={handleResetFolderStats}
                    >
                      선택 폴더 복습 일정 초기화
                    </button>
                    {nasWebhookUrl && (
                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleSyncFromNas(false, nasWebhookUrl, false)}
                        >
                          ☁️ 기기 간 즉시 동기화
                        </button>
                    )}
                  </div>
                </div>

                <div className="gg-summary-box">
                  <div>
                    <div>
                      선택된 단어: {selectedPoolItems.length}개 / 전체 {items.length}개
                    </div>
                    <div>
                      누적 학습 횟수: {selectionMetrics.totalTries}회 · 평균 시간:{' '}
                      {selectionMetrics.avgSec}초
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="secondary-btn" onClick={handleExportJson}>
                      백업 저장
                    </button>
                    <button
                        type="button"
                        className="submit-btn"
                        onClick={() => setShowGgModal(false)}
                    >
                      확인
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}

        {activeTab === 'study' && (
            <div className="study-main">
              {/* 자유 복습(벼락치기) 모드 활성화 배너 */}
              {isCramMode && (
                  <div className="cram-banner">
              <span>
                ⚡ <strong>자유 복습(벼락치기) 모드</strong> 진행 중 · FSRS 일정 변경 없이 남은{' '}
                {dueItems.length}단어를 테스트합니다
              </span>
                    <button type="button" className="secondary-btn" onClick={exitCramMode}>
                      일반 모드로 종료
                    </button>
                  </div>
              )}

              {/* 1순위: 제목 바로 아래 플래시카드 최상단 배치 */}
              {!currentItem ? (
                  <div className="done-card">
                    <div className="done-icon">
                      <Sparkles size={26} />
                    </div>
                    <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem' }}>
                      [{studyCategory === 'ALL' ? '전체 단어장' : studyCategory}]{' '}
                      {isCramMode ? '자유 복습 완료!' : '오늘 복습 완료!'}
                    </h2>
                    <p style={{ color: '#64748b', fontSize: '0.86rem', marginBottom: 16 }}>
                      오늘 총 <strong>{stats.todayReviewed}회</strong> 복습을 마쳤습니다.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {filteredPoolItems.length > 0 && (
                          <button
                              type="button"
                              className="submit-btn"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                              onClick={() => startCramMode()}
                          >
                            <Zap size={15} />
                            ⚡ 자유 복습 (벼락치기 {filteredPoolItems.length}단어)
                          </button>
                      )}
                      {isCramMode && (
                          <button type="button" className="secondary-btn" onClick={exitCramMode}>
                            일반 모드로 돌아가기
                          </button>
                      )}
                      {studyFilter !== 'all' && (
                          <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => setStudyFilter('all')}
                          >
                            전체 필터 보기
                          </button>
                      )}
                      {studyCategory !== 'ALL' && (
                          <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => setStudyCategory('ALL')}
                          >
                            전체 단어장 보기
                          </button>
                      )}
                      <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setIsFolderSidebarOpen(true)}
                      >
                        📂 다른 폴더 선택
                      </button>
                    </div>
                  </div>
              ) : studyMode === 'flashcard' ? (
                  <>
                    <div
                        className="study-card clickable"
                        onClick={() => setIsFlipped((prev) => !prev)}
                    >
                      <div className="card-top-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge-state">
                      {isCramMode ? '⚡ 자유 복습' : getStateLabel(currentItem.card.state)}
                    </span>
                          <span className="cat-badge">
                      <FolderOpen size={11} />
                            {normalizeCategory(currentItem.tag)}
                    </span>
                          {isWeakItem(currentItem) && (
                              <span
                                  className="badge-state"
                                  style={{ background: '#ffedd5', color: '#c2410c' }}
                              >
                        🔥 취약 단어
                      </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                              type="button"
                              className={`star-circle-btn ${currentItem.starred ? 'active' : ''}`}
                              title="별표(⭐) 단어장 추가/해제 (단축키 S)"
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
                              title={
                                isFlipped ? '영어 예문 듣기 (단축키 R)' : '단어 발음 듣기 (단축키 R)'
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isFlipped) {
                                  speakExampleOrWord(currentItem, speechRate);
                                } else {
                                  speakWord(currentItem.word, speechRate);
                                }
                              }}
                          >
                            <Volume2 size={19} />
                          </button>
                        </div>
                      </div>

                      <div className="card-center">
                        <h2 className="word-display">{currentItem.word}</h2>
                        {currentItem.phonetic && (
                            <div className="phonetic-display">{currentItem.phonetic}</div>
                        )}

                        {isFlipped && (
                            <>
                              <div className="meaning-display">{currentItem.meaning}</div>
                              {currentItem.example && (
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
                              )}
                            </>
                        )}
                      </div>

                      <div className="flip-hint">
                        <RotateCcw size={13} />
                        {!isFlipped
                            ? '카드를 터치(또는 Space)하면 뜻과 함께 영어 예문을 읽어줍니다'
                            : '다시(1)/어려움(2)은 끝부분에 다시 나오고, 보통(3)/쉬움(4)은 통과합니다'}
                      </div>
                    </div>

                    {isFlipped && (
                        <div className="rating-section">
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
                        </div>
                    )}
                  </>
              ) : (
                  <>
                    <div className="study-card">
                      <div className="card-top-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge-state">
                      {isCramMode ? '⚡ 자유 복습' : getStateLabel(currentItem.card.state)}
                    </span>
                          <span className="cat-badge">
                      <FolderOpen size={11} />
                            {normalizeCategory(currentItem.tag)}
                    </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                              type="button"
                              className={`star-circle-btn ${currentItem.starred ? 'active' : ''}`}
                              title="별표(⭐) 단어장 추가/해제"
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
                                단어 발음 듣기
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
                            <form className="spelling-form" onSubmit={handleCheckSpelling}>
                              <input
                                  ref={spellingInputRef}
                                  type="text"
                                  className="spelling-input"
                                  placeholder="영어 단어 입력 후 엔터 또는 확인..."
                                  value={typedAnswer}
                                  onChange={(e) => setTypedAnswer(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      submitSpellingAnswer();
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
                                  onClick={handleCheckSpelling}
                              >
                                확인
                              </button>
                            </form>
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
                              <div className="answer-compare">
                                정답: <strong>{currentItem.word}</strong>{' '}
                                {currentItem.phonetic && <span>{currentItem.phonetic}</span>}
                              </div>
                              {currentItem.example && (
                                  <div
                                      className="example-box"
                                      onClick={() => speakExampleOrWord(currentItem, speechRate)}
                                  >
                                    {currentItem.example}
                                  </div>
                              )}
                            </div>
                        )}
                      </div>
                    </div>

                    {spellingResult && (
                        <div className="rating-section">
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
                        </div>
                    )}
                  </>
              )}

              {/* 2순위 (카드 아래): 모드 전환 & 5단계 TTS 배속 컨트롤 바 */}
              <div className="toolbar">
                <div className="mode-switch">
                  <button
                      type="button"
                      className={`mode-btn ${studyMode === 'flashcard' ? 'active' : ''}`}
                      onClick={() => {
                        setStudyMode('flashcard');
                        resetCardInteraction();
                      }}
                  >
                    <Layers size={15} />
                    플래시카드
                  </button>
                  <button
                      type="button"
                      className={`mode-btn ${studyMode === 'spelling' ? 'active' : ''}`}
                      onClick={() => {
                        setStudyMode('spelling');
                        resetCardInteraction();
                      }}
                  >
                    <Keyboard size={15} />
                    스펠링 테스트
                  </button>
                </div>

                <div className="toolbar-actions">
                  <div className="speed-group" title="발음 읽어주기 속도">
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
                    {autoSpeak ? '자동' : '수동'}
                  </button>
                </div>
              </div>

              {/* 2.5순위 (안키 스타일 보조 바): 별표/취약 필터 + 실행 취소(Undo) + 자유 복습(벼락치기) */}
              <div className="anki-filter-bar">
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
                    전체 ({selectedPoolItems.length})
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
                              selectedPoolItems.filter((it) => isWeakItem(it)).map((it) => it.id)
                          );
                        }
                        resetCardInteraction();
                      }}
                  >
                    <Flame size={13} />
                    취약 단어 ({weakCount})
                  </button>
                </div>

                <div className="filter-chip-group">
                  <button
                      type="button"
                      className="undo-btn"
                      disabled={undoStack.length === 0}
                      onClick={handleUndo}
                      title="방금 넘긴 카드 되돌리기 (단축키 Z)"
                  >
                    <Undo2 size={14} />
                    되돌리기 {undoStack.length > 0 ? `(${undoStack.length})` : ''}
                  </button>
                  <button
                      type="button"
                      className={`cram-toggle-btn ${isCramMode ? 'active' : ''}`}
                      onClick={() => (isCramMode ? exitCramMode() : startCramMode())}
                      title="FSRS 복습 일정을 유지한 채 현재 폴더 전체 단어를 테스트합니다"
                  >
                    <Zap size={13} />
                    {isCramMode ? '자유 복습 종료' : '자유 복습 (벼락치기)'}
                  </button>
                </div>
              </div>

              {/* 3순위 (카드 아래): 폴더/통계 관리, 폴더 선택, 기기 간 동기화, 연속 학습일, 남은 복습 */}
              <div
                  className="header-badges"
                  style={{
                    justifyContent: 'space-between',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 14,
                    padding: '10px 12px',
                  }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                      type="button"
                      className="gg-open-btn"
                      onClick={() => setShowGgModal(true)}
                  >
                    <Settings2 size={14} />
                    폴더/통계 관리
                  </button>
                  <button
                      type="button"
                      className="secondary-btn"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '6px 10px',
                        fontSize: '0.76rem',
                      }}
                      onClick={() => setIsFolderSidebarOpen((prev) => !prev)}
                  >
                    {isFolderSidebarOpen ? (
                        <PanelLeftClose size={14} />
                    ) : (
                        <PanelLeftOpen size={14} />
                    )}
                    {isFolderSidebarOpen ? '폴더 닫기' : '폴더 선택'}
                  </button>
                  <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => setShowNasConfig((prev) => !prev)}
                      title="NAS 동기화 웹훅 설정"
                  >
                    <Server size={15} />
                  </button>
                  {nasWebhookUrl && (
                      <button
                          type="button"
                          className="mini-icon-btn"
                          onClick={() => handleSyncFromNas(false, undefined, false)}
                          title="PC · 아이폰 · 안드로이드 동기화"
                      >
                        <RefreshCw size={15} className={isSyncing ? 'spin' : ''} />
                      </button>
                  )}
                  {deferredPrompt && (
                      <button
                          type="button"
                          className="install-app-btn"
                          onClick={handleInstallPwa}
                      >
                        <Smartphone size={14} />
                        앱 설치
                      </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="streak-pill" title="매일 연속 학습한 출석 일수">
                    <Flame size={14} />
                    {stats.streak}일째
                  </div>
                  <div className="due-pill" title="남은 복습 단어 수">
                    {isCramMode ? `벼락치기 ${dueItems.length}` : `남은 복습 ${dueItems.length}`}
                  </div>
                </div>
              </div>

              {showNasConfig && (
                  <div className="api-key-box">
                    <div>
                      <strong>NAS n8n 동기화 주소 (PC · 아이폰 · 안드로이드 공용)</strong>
                    </div>
                    <div className="api-key-row">
                      <input
                          type="url"
                          className="mini-input"
                          style={{ flex: 1 }}
                          value={nasUrlInput}
                          onChange={(e) => setNasUrlInput(e.target.value)}
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
                    </div>
                  </div>
              )}

              {/* 폴더 선택 버튼을 눌렀을 때 카드 아래에 펼쳐지는 폴더 트리 */}
              {isFolderSidebarOpen && (
                  <aside className="folder-sidebar">
                    <div className="folder-sidebar-header">
                <span className="folder-sidebar-title">
                  <FolderOpen size={15} />
                  문제집 폴더 목록
                </span>
                      <button
                          type="button"
                          className="helper-chip"
                          style={{ padding: '3px 7px', fontSize: '0.7rem' }}
                          onClick={() => setShowGgModal(true)}
                      >
                        + 새 폴더 / 전체 편집
                      </button>
                    </div>

                    <div className="folder-list">
                      <div className="folder-item-wrap">
                        <button
                            type="button"
                            className={`folder-item ${studyCategory === 'ALL' ? 'active' : ''}`}
                            onClick={() => {
                              setStudyCategory('ALL');
                              setIsCramMode(false);
                              resetCardInteraction();
                            }}
                        >
                    <span className="folder-item-left">
                      <FolderOpen size={15} />
                      <span className="folder-name">전체 단어장</span>
                    </span>
                          <span className="folder-count">
                      {allCounts.due}/{allCounts.total}
                    </span>
                        </button>
                      </div>

                      {folderTree.map((group, gIdx) => {
                        const parentCounts = getFolderCounts(group.parent);
                        const isParentActive = studyCategory === group.parent;
                        const isCollapsed = !!collapsedParents[group.parent];

                        return (
                            <div key={group.parent} className="folder-tree-group">
                              <div className="folder-item-wrap">
                                {group.children.length > 0 && (
                                    <button
                                        type="button"
                                        className="folder-expand-btn"
                                        onClick={() =>
                                            setCollapsedParents((prev) => ({
                                              ...prev,
                                              [group.parent]: !prev[group.parent],
                                            }))
                                        }
                                    >
                                      {isCollapsed ? (
                                          <ChevronRight size={13} />
                                      ) : (
                                          <ChevronDown size={13} />
                                      )}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className={`folder-item ${isParentActive ? 'active' : ''}`}
                                    onClick={() => {
                                      setStudyCategory(group.parent);
                                      setTargetCategory(group.parent);
                                      setIsCramMode(false);
                                      resetCardInteraction();
                                    }}
                                >
                          <span className="folder-item-left">
                            {isParentActive ? <FolderOpen size={14} /> : <Folder size={14} />}
                            <span className="folder-name">{group.parent}</span>
                          </span>
                                  <span className="folder-count">
                            {parentCounts.due}/{parentCounts.total}
                          </span>
                                </button>
                                <button
                                    type="button"
                                    className="folder-action-btn"
                                    title="위로 이동"
                                    disabled={gIdx === 0}
                                    onClick={() => handleMoveParentFolder(group.parent, 'up')}
                                >
                                  <ArrowUp size={12} />
                                </button>
                                <button
                                    type="button"
                                    className="folder-action-btn"
                                    title="아래로 이동"
                                    disabled={gIdx === folderTree.length - 1}
                                    onClick={() => handleMoveParentFolder(group.parent, 'down')}
                                >
                                  <ArrowDown size={12} />
                                </button>
                                <button
                                    type="button"
                                    className="folder-action-btn"
                                    title="하위 유닛 추가"
                                    onClick={() => handleQuickAddSubfolder(group.parent)}
                                >
                                  <Plus size={12} />
                                </button>
                                <button
                                    type="button"
                                    className="folder-action-btn"
                                    title="이름 변경"
                                    onClick={() => handleRenameFolder(group.parent)}
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                    type="button"
                                    className="folder-action-btn danger"
                                    title="폴더 삭제"
                                    onClick={() => handleDeleteCategory(group.parent)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>

                              {!isCollapsed && group.children.length > 0 && (
                                  <div className="folder-sub-list">
                                    {group.children.map((child, cIdx) => {
                                      const childCounts = getFolderCounts(child.fullPath);
                                      const isChildActive = studyCategory === child.fullPath;
                                      return (
                                          <div key={child.fullPath} className="folder-item-wrap">
                                            <button
                                                type="button"
                                                className={`folder-item ${isChildActive ? 'active' : ''}`}
                                                onClick={() => {
                                                  setStudyCategory(child.fullPath);
                                                  setTargetCategory(child.fullPath);
                                                  setIsCramMode(false);
                                                  resetCardInteraction();
                                                }}
                                            >
                                  <span className="folder-item-left">
                                    <Folder size={13} />
                                    <span className="folder-name">{child.childName}</span>
                                  </span>
                                              <span className="folder-count">
                                    {childCounts.due}/{childCounts.total}
                                  </span>
                                            </button>
                                            <button
                                                type="button"
                                                className="folder-action-btn"
                                                title="위로 이동"
                                                disabled={cIdx === 0}
                                                onClick={() =>
                                                    handleMoveChildFolder(group.parent, child.fullPath, 'up')
                                                }
                                            >
                                              <ArrowUp size={11} />
                                            </button>
                                            <button
                                                type="button"
                                                className="folder-action-btn"
                                                title="아래로 이동"
                                                disabled={cIdx === group.children.length - 1}
                                                onClick={() =>
                                                    handleMoveChildFolder(
                                                        group.parent,
                                                        child.fullPath,
                                                        'down'
                                                    )
                                                }
                                            >
                                              <ArrowDown size={11} />
                                            </button>
                                            <button
                                                type="button"
                                                className="folder-action-btn"
                                                title="이름 변경"
                                                onClick={() => handleRenameFolder(child.fullPath)}
                                            >
                                              <Pencil size={11} />
                                            </button>
                                            <button
                                                type="button"
                                                className="folder-action-btn danger"
                                                title="삭제"
                                                onClick={() => handleDeleteCategory(child.fullPath)}
                                            >
                                              <Trash2 size={11} />
                                            </button>
                                          </div>
                                      );
                                    })}
                                  </div>
                              )}
                            </div>
                        );
                      })}
                    </div>
                  </aside>
              )}

              {/* PC 키보드 단축키 안내 바 */}
              <div className="shortcut-hint-bar">
                ⌨️ PC 단축키: <strong>Space</strong> (카드 뒤집기) · <strong>1~4</strong> (다시/어려움/보통/쉬움) ·{' '}
                <strong>R</strong> (발음/예문 듣기) · <strong>S</strong> (별표 토글) · <strong>Z</strong> (되돌리기)
              </div>

              {/* 4순위 (제일 하단): FSRS 학습 통계 */}
              <div className="bottom-stats-wrap">
                <button
                    type="button"
                    className="stats-toggle-btn"
                    onClick={() => setShowBottomStats((prev) => !prev)}
                >
                  <BarChart2 size={14} />
                  {showBottomStats ? '학습 통계 숨기기 ▲' : '상세 학습 통계 보기 ▼'}
                </button>

                {showBottomStats && (
                    <div className="gg-stats-banner">
                      <div className="gg-stats-line1">
                        [오늘 공부량] 총{' '}
                        <span className="gg-blue">{stats.todayReviewed}문제</span> 복습 완료
                      </div>
                      <div className="gg-stats-line3">
                        이 단어 누적 복습: {currentCardMetrics.totalTries}회 &nbsp;|&nbsp; 평균 시간:{' '}
                        {currentCardMetrics.avgSec}초 &nbsp;|&nbsp; 상태: ●{' '}
                        {currentItem ? getStateLabel(currentItem.card.state) : '대기 중'}{' '}
                        &nbsp;|&nbsp; 마지막 풀이: {currentCardMetrics.lastSolved}
                      </div>
                    </div>
                )}
              </div>
            </div>
        )}

        {activeTab === 'add' && (
            <div className="panel-card">
              <div className="category-select-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="field-label">
                📁 책 제목 또는 상위/하위 폴더 (책 제목만 적어도 큰 제목 페이지 기준으로 자동 묶입니다)
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
                  사진 스캔 (큰제목 자동묶음)
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
                    className={`sub-tab-btn ${addSubTab === 'bulk' ? 'active' : ''}`}
                    onClick={() => setAddSubTab('bulk')}
                >
                  일괄 붙여넣기
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

              {addSubTab === 'bulk' && (
                  <>
              <textarea
                  className="bulk-textarea"
                  placeholder="early - (형용사) 이른, (부사) 일찍 | I often take walks in the early morning."
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
              />
                    <button type="button" className="primary-full-btn" onClick={handleAddBulk}>
                      [{normalizeCategory(targetCategory)}]에 일괄 등록하기
                    </button>
                  </>
              )}
            </div>
        )}

        {/* 단어 목록 탭: 계층형 폴더 트리 + 별표/취약 필터 + 단어별 별표/수정/삭제 */}
        {activeTab === 'list' && (
            <div className="panel-card">
              <div className="list-folder-tree-box">
                <div className="folder-sidebar-header">
              <span className="folder-sidebar-title">
                <FolderOpen size={15} />
                문제집 폴더 목록 (클릭하여 폴더별 단어 보기 · ▲/▼ 위치 이동 · ✏️ 이름 수정)
              </span>
                  <button
                      type="button"
                      className="helper-chip"
                      style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                      onClick={() => setShowGgModal(true)}
                  >
                    + 새 폴더 추가
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

                  {folderTree.map((group, gIdx) => {
                    const parentCounts = getFolderCounts(group.parent);
                    const isParentActive = listCategory === group.parent;
                    const isCollapsed = !!collapsedParents[group.parent];

                    return (
                        <div key={group.parent} className="folder-tree-group">
                          <div className="folder-item-wrap">
                            {group.children.length > 0 && (
                                <button
                                    type="button"
                                    className="folder-expand-btn"
                                    onClick={() =>
                                        setCollapsedParents((prev) => ({
                                          ...prev,
                                          [group.parent]: !prev[group.parent],
                                        }))
                                    }
                                >
                                  {isCollapsed ? (
                                      <ChevronRight size={13} />
                                  ) : (
                                      <ChevronDown size={13} />
                                  )}
                                </button>
                            )}
                            <button
                                type="button"
                                className={`folder-item ${isParentActive ? 'active' : ''}`}
                                onClick={() => setListCategory(group.parent)}
                            >
                        <span className="folder-item-left">
                          {isParentActive ? <FolderOpen size={14} /> : <Folder size={14} />}
                          <span className="folder-name">★ {group.parent}</span>
                        </span>
                              <span className="folder-count">{parentCounts.total}단어</span>
                            </button>
                            <button
                                type="button"
                                className="folder-action-btn"
                                title="위로 이동"
                                disabled={gIdx === 0}
                                onClick={() => handleMoveParentFolder(group.parent, 'up')}
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                                type="button"
                                className="folder-action-btn"
                                title="아래로 이동"
                                disabled={gIdx === folderTree.length - 1}
                                onClick={() => handleMoveParentFolder(group.parent, 'down')}
                            >
                              <ArrowDown size={12} />
                            </button>
                            <button
                                type="button"
                                className="folder-action-btn"
                                title="하위 유닛 추가"
                                onClick={() => handleQuickAddSubfolder(group.parent)}
                            >
                              <Plus size={12} />
                            </button>
                            <button
                                type="button"
                                className="folder-action-btn"
                                title="폴더 이름 변경"
                                onClick={() => handleRenameFolder(group.parent)}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                                type="button"
                                className="folder-action-btn danger"
                                title="폴더 삭제"
                                onClick={() => handleDeleteCategory(group.parent)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {!isCollapsed && group.children.length > 0 && (
                              <div className="folder-sub-list">
                                {group.children.map((child, cIdx) => {
                                  const childCounts = getFolderCounts(child.fullPath);
                                  const isChildActive = listCategory === child.fullPath;
                                  return (
                                      <div key={child.fullPath} className="folder-item-wrap">
                                        <button
                                            type="button"
                                            className={`folder-item ${isChildActive ? 'active' : ''}`}
                                            onClick={() => setListCategory(child.fullPath)}
                                        >
                                <span className="folder-item-left">
                                  <Folder size={13} />
                                  <span className="folder-name">{child.childName}</span>
                                </span>
                                          <span className="folder-count">{childCounts.total}단어</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="folder-action-btn"
                                            title="위로 이동"
                                            disabled={cIdx === 0}
                                            onClick={() =>
                                                handleMoveChildFolder(group.parent, child.fullPath, 'up')
                                            }
                                        >
                                          <ArrowUp size={11} />
                                        </button>
                                        <button
                                            type="button"
                                            className="folder-action-btn"
                                            title="아래로 이동"
                                            disabled={cIdx === group.children.length - 1}
                                            onClick={() =>
                                                handleMoveChildFolder(group.parent, child.fullPath, 'down')
                                            }
                                        >
                                          <ArrowDown size={11} />
                                        </button>
                                        <button
                                            type="button"
                                            className="folder-action-btn"
                                            title="이름 변경"
                                            onClick={() => handleRenameFolder(child.fullPath)}
                                        >
                                          <Pencil size={11} />
                                        </button>
                                        <button
                                            type="button"
                                            className="folder-action-btn danger"
                                            title="삭제"
                                            onClick={() => handleDeleteCategory(child.fullPath)}
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                  );
                                })}
                              </div>
                          )}
                        </div>
                    );
                  })}
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

              {/* 단어 목록 내 별표/취약 필터 바 */}
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
                  별표 단어만 ({items.filter((it) => isCategoryMatch(it.tag, listCategory) && it.starred).length})
                </button>
                <button
                    type="button"
                    className={`filter-chip weak ${studyFilter === 'weak' ? 'active' : ''}`}
                    onClick={() => setStudyFilter('weak')}
                >
                  <Flame size={13} />
                  취약 단어만 ({items.filter((it) => isCategoryMatch(it.tag, listCategory) && isWeakItem(it)).length})
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