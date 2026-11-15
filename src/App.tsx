import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type FormEvent,
  type ChangeEvent,
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
} from 'lucide-react';
import type {
  VocabItem,
  StudyMode,
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
} from './utils/cloudSync';

interface FolderTreeNode {
  parent: string;
  children: Array<{ fullPath: string; childName: string }>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
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
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [speechRate, setSpeechRate] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SPEECH_RATE_STORAGE_KEY));
    return SPEECH_RATES.includes(saved) ? saved : 0.9;
  });
  const speechRateRef = useRef<number>(speechRate);
  const speechTimeoutRef = useRef<number | null>(null);

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

  // 브라우저 TTS 음성 목록 미리 로드 (모바일 배속 정상 작동용)
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

  const allCategories = useMemo(() => {
    const set = new Set<string>(customCategories);
    items.forEach((item) => set.add(normalizeCategory(item.tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
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

  const selectionMetrics = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let totalTimeMs = 0;
    selectedPoolItems.forEach((item) => {
      wins += item.itemStats?.wins || 0;
      losses += item.itemStats?.losses || 0;
      totalTimeMs += item.itemStats?.totalTimeMs || 0;
    });
    const attempts = wins + losses;
    const rightPct = attempts > 0 ? ((wins / attempts) * 100).toFixed(1) : '0.0';
    const avgSec = attempts > 0 ? (totalTimeMs / attempts / 1000).toFixed(2) : '0.00';
    return { wins, attempts, rightPct, avgSec };
  }, [selectedPoolItems]);

  const dueItems = useMemo(() => {
    const endOfToday = new Date().setHours(23, 59, 59, 999);
    const list = selectedPoolItems.filter((item) => item.card.due.getTime() <= endOfToday);

    return [...list].sort((a, b) => {
      const aLast = a.itemStats?.lastSolvedAt || 0;
      const bLast = b.itemStats?.lastSolvedAt || 0;
      if (aLast !== bLast) {
        return aLast - bLast;
      }
      return a.card.due.getTime() - b.card.due.getTime();
    });
  }, [selectedPoolItems]);

  const currentItem = dueItems[0] ?? null;

  useEffect(() => {
    cardStartTimeRef.current = Date.now();
  }, [currentItem?.id, studyCategory]);

  // 5번 해결: 모바일/PC 브라우저에서 배속(rate)이 무시되지 않도록 60ms 딜레이 + 원어민 음성 바인딩
  const speakWord = (text: string, customRate?: number) => {
    if (!('speechSynthesis' in window) || !text.trim()) return;

    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
    }
    window.speechSynthesis.cancel();

    const targetRate = customRate ?? speechRateRef.current;
    const cleanText = text.trim();

    speechTimeoutRef.current = window.setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voices = window.speechSynthesis.getVoices();
      const enVoice =
          voices.find((v) => v.lang === 'en-US' && v.localService) ||
          voices.find((v) => v.lang === 'en-US') ||
          voices.find((v) => v.lang.startsWith('en'));

      if (enVoice) {
        utterance.voice = enVoice;
      }
      utterance.lang = 'en-US';
      utterance.rate = targetRate;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }, 60);
  };

  useEffect(() => {
    if (
        activeTab === 'study' &&
        studyMode === 'flashcard' &&
        autoSpeak &&
        currentItem &&
        !isFlipped
    ) {
      speakWord(currentItem.word, speechRateRef.current);
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

  const handleAddFolderHierarchy = () => {
    const p = formatFolderSegment(newParentFolder.replace(/\//g, ' '));
    const c = formatFolderSegment(newChildFolder.replace(/\//g, ' '));
    if (!p && !c) return;
    const fullPath = p && c ? `${p}/${c}` : p || c;
    setCustomCategories((prev) => Array.from(new Set([...prev, fullPath])));
    setTargetCategory(fullPath);
    setStudyCategory(fullPath);
    setNewParentFolder('');
    setNewChildFolder('');
    showToast(`📁 [${fullPath}] 폴더가 생성되었습니다.`);
  };

  const handleQuickAddSubfolder = (parentName: string) => {
    const sub = window.prompt(
        `[${parentName}] 상위 폴더 아래에 만들 하위 폴더(유닛) 이름을 입력하세요:`,
        'Unit 01'
    );
    if (!sub || !sub.trim()) return;
    const fullPath = normalizeCategory(`${parentName}/${sub.trim()}`);
    setCustomCategories((prev) => Array.from(new Set([...prev, fullPath])));
    setStudyCategory(fullPath);
    setTargetCategory(fullPath);
    showToast(`📁 [${fullPath}] 하위 폴더가 추가되었습니다.`);
  };

  const handleRenameFolder = (oldPath: string) => {
    const nextName = window.prompt(
        `폴더 이름을 변경합니다 ("상위폴더/하위폴더" 형식 입력 가능):`,
        oldPath
    );
    if (!nextName || !nextName.trim() || nextName.trim() === oldPath) return;
    const cleaned = normalizeCategory(nextName);

    setItems((prev) =>
        prev.map((item) => {
          const norm = normalizeCategory(item.tag);
          if (norm === oldPath) return { ...item, tag: cleaned };
          if (norm.startsWith(`${oldPath}/`)) {
            return {
              ...item,
              tag: normalizeCategory(`${cleaned}/${norm.slice(oldPath.length + 1)}`),
            };
          }
          return item;
        })
    );
    setCustomCategories((prev) =>
        prev.map((cat) => {
          if (cat === oldPath) return cleaned;
          if (cat.startsWith(`${oldPath}/`)) {
            return normalizeCategory(`${cleaned}/${cat.slice(oldPath.length + 1)}`);
          }
          return cat;
        })
    );
    if (studyCategory === oldPath) setStudyCategory(cleaned);
    if (targetCategory === oldPath) setTargetCategory(cleaned);
    showToast(`✏️ [${oldPath}] → [${cleaned}] 변경 완료`);
  };

  const handleDeleteCategory = (folderPath: string) => {
    const { total } = getFolderCounts(folderPath);
    const msg =
        total > 0
            ? `[${folderPath}] 폴더(하위 유닛 포함)와 단어 ${total}개를 모두 삭제하시겠습니까?`
            : `[${folderPath}] 빈 폴더를 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;

    setItems((prev) => prev.filter((item) => !isCategoryMatch(item.tag, folderPath)));
    setCustomCategories((prev) =>
        prev.filter((c) => c !== folderPath && !c.startsWith(`${folderPath}/`))
    );
    if (isCategoryMatch(studyCategory, folderPath)) setStudyCategory('ALL');
    if (isCategoryMatch(listCategory, folderPath)) setListCategory('ALL');
    showToast(`🗑️ [${folderPath}] 폴더가 삭제되었습니다.`);
  };

  const handleResetFolderStats = () => {
    const label = studyCategory === 'ALL' ? '전체 단어장' : studyCategory;
    if (!window.confirm(`[${label}]의 학습 기록과 FSRS 복습 일정을 처음 상태로 초기화하시겠습니까?`)) {
      return;
    }
    const nowDate = new Date();
    setItems((prev) =>
        prev.map((item) => {
          if (!isCategoryMatch(item.tag, studyCategory)) return item;
          return {
            ...item,
            itemStats: createEmptyItemStats(),
            card: createNewVocabItem(item.word, item.meaning, item.example, nowDate, item.tag)
                .card,
          };
        })
    );
    setStats((prev) => ({
      ...prev,
      todayReviewed: 0,
      todayCorrect: 0,
      todayWrong: 0,
    }));
    showToast(`🔄 [${label}] 통계 및 복습 일정이 초기화되었습니다.`);
  };

  const handleRate = (grade: Grade) => {
    if (!currentItem) return;
    const nowDate = new Date();
    const elapsedMs = Math.min(120000, Math.max(500, Date.now() - cardStartTimeRef.current));
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

    const isWin =
        grade === Rating.Easy &&
        (studyMode !== 'spelling' || spellingResult === 'correct');

    setItems((prev) =>
        prev.map((item) => {
          if (item.id !== currentItem.id) return item;
          const prevStats = item.itemStats ?? createEmptyItemStats();
          const nextHistory: Array<'O' | 'X'> = [
            ...prevStats.recentHistory,
            isWin ? ('O' as const) : ('X' as const),
          ].slice(-10);

          return {
            ...item,
            card: nextCard,
            itemStats: {
              wins: prevStats.wins + (isWin ? 1 : 0),
              losses: prevStats.losses + (isWin ? 0 : 1),
              recentHistory: nextHistory,
              totalTimeMs: prevStats.totalTimeMs + elapsedMs,
              lastSolvedAt: nowDate.getTime(),
            },
          };
        })
    );

    setStats((prev) => recordAnswerStats(prev, isWin));
    resetCardInteraction();
  };

  const handleCheckSpelling = (e: FormEvent) => {
    e.preventDefault();
    if (!currentItem || !typedAnswer.trim()) return;
    const normalizedInput = typedAnswer.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedTarget = currentItem.word.trim().replace(/\s+/g, ' ').toLowerCase();
    setSpellingResult(normalizedInput === normalizedTarget ? 'correct' : 'wrong');
    speakWord(currentItem.word);
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
      const { newItems, newCategories } = await fetchNewNasVocab(
          items,
          targetUrl,
          forceResync
      );
      if (newItems.length > 0) {
        const formattedCats = newCategories.map((c) => normalizeCategory(c));
        setItems((prev) => [...newItems, ...prev]);
        setCustomCategories((prev) => Array.from(new Set([...prev, ...formattedCats])));
        showToast(
            `📥 NAS에서 새 단어 ${newItems.length}개(${formattedCats.join(', ')})를 가져왔습니다!`
        );
      } else if (!silent) {
        showToast('NAS 동기화 완료! 새로 추가된 단어가 없습니다.');
      }
    } catch {
      if (!silent) {
        showToast('NAS 연결에 실패했습니다. 웹훅 주소를 확인해 주세요.');
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
    setCustomCategories((prev) => Array.from(new Set([...prev, ...folderList])));
    setItems((prev) => [...created, ...prev]);
    setExtractedDrafts([]);
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
    setCustomCategories((prev) => Array.from(new Set([...prev, normFolder])));
    setItems((prev) => [created, ...prev]);
    setNewWord('');
    setNewPhonetic('');
    setNewMeaning('');
    setNewExample('');
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
    setCustomCategories((prev) => Array.from(new Set([...prev, normFolder])));
    setItems((prev) => [...added, ...prev]);
    setBulkText('');
    showToast(`[${normFolder}]에 ${added.length}개 단어가 등록되었습니다.`);
  };

  const handleExportJson = () => {
    const payload = {
      app: '소이의 단어 암기장',
      version: 6,
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
      setItems((prev) => {
        const map = new Map<string, VocabItem>();
        prev.forEach((item) =>
            map.set(`${normalizeCategory(item.tag)}::${item.word.toLowerCase()}`, item)
        );
        imported.forEach((item) =>
            map.set(`${normalizeCategory(item.tag)}::${item.word.toLowerCase()}`, item)
        );
        return Array.from(map.values());
      });
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
      if (!q) return true;
      return (
          item.word.toLowerCase().includes(q) ||
          item.meaning.toLowerCase().includes(q) ||
          (item.example && item.example.toLowerCase().includes(q))
      );
    });
  }, [items, searchQuery, listCategory]);

  const currentCardMetrics = useMemo(() => {
    const st = currentItem?.itemStats ?? createEmptyItemStats();
    const totalTries = st.wins + st.losses;
    const winRate = totalTries > 0 ? ((st.wins / totalTries) * 100).toFixed(1) : '0.0';
    const recentCount = st.recentHistory.length;
    const recentWins = st.recentHistory.filter((x) => x === 'O').length;
    const recentRate =
        recentCount > 0 ? Math.round((recentWins / recentCount) * 100) : 0;
    const recentStr =
        recentCount > 0 ? `${st.recentHistory.join(' ')} (${recentRate}%)` : '- (0%)';
    const avgSec =
        totalTries > 0 ? (st.totalTimeMs / totalTries / 1000).toFixed(1) : '0.0';
    return {
      totalTries,
      wins: st.wins,
      losses: st.losses,
      winRate,
      recentCount,
      recentStr,
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
          label: '다시 (패)',
          className: 'rate-again',
          intervalText: '오늘 끝부분 재복습',
        },
        {
          grade: Rating.Hard,
          label: '어려움 (패)',
          className: 'rate-hard',
          intervalText: '오늘 끝부분 재복습',
        },
        {
          grade: Rating.Good,
          label: '보통 (패)',
          className: 'rate-good',
          intervalText:
              scheduling[Rating.Good].card.due.getTime() <=
              new Date().setHours(23, 59, 59, 999)
                  ? '1일 뒤'
                  : formatInterval(scheduling[Rating.Good].card.due, now),
        },
        {
          grade: Rating.Easy,
          label: '쉬움 (승)',
          className: 'rate-easy',
          intervalText: formatInterval(scheduling[Rating.Easy].card.due, now),
        },
      ]
      : [];

  const allCounts = getFolderCounts('ALL');

  return (
      <div className="app-shell">
        {/* 3번 요청: 최상단에는 '소이의 단어 암기장' 제목과 설명 글만 배치 */}
        <header className="app-header">
          <div>
            <h1 className="app-title">소이의 단어 암기장</h1>
            <p className="app-subtitle">전체 {items.length}단어 · FSRS 망각곡선 단어장</p>
          </div>
        </header>

        {toastMsg && <div className="toast-banner">{toastMsg}</div>}

        {/* 폴더 목록 & 통계 관리 모달 */}
        {showGgModal && (
            <div className="gg-modal-backdrop" onClick={() => setShowGgModal(false)}>
              <div className="gg-modal" onClick={(e) => e.stopPropagation()}>
                <div className="gg-modal-header">
              <span className="gg-modal-title">
                ⚙️ 문제집 폴더 목록 & 학습 통계 관리
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
                  <div className="gg-box-title">문제집 폴더 목록 (상위 책 / 하위 유닛)</div>
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

                    {folderTree.map((group) => {
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
                                  {group.children.map((child) => {
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
                      선택 폴더 통계/일정 초기화
                    </button>
                  </div>
                </div>

                <div className="gg-summary-box">
                  <div>
                    <div>
                      # Selected: {selectedPoolItems.length} / 총 {items.length}
                    </div>
                    <div>
                      % Right (쉬움 비율): {selectionMetrics.rightPct}% ({selectionMetrics.wins} / 총{' '}
                      {selectionMetrics.attempts})
                    </div>
                    <div>Avg. Time: {selectionMetrics.avgSec}s</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="secondary-btn" onClick={handleExportJson}>
                      Export...
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
              {/* 1순위: 제목 바로 아래 플래시카드 최상단 배치 */}
              {!currentItem ? (
                  <div className="done-card">
                    <div className="done-icon">
                      <Sparkles size={26} />
                    </div>
                    <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem' }}>
                      [{studyCategory === 'ALL' ? '전체 단어장' : studyCategory}] 오늘 복습 완료!
                    </h2>
                    <p style={{ color: '#64748b', fontSize: '0.86rem', marginBottom: 16 }}>
                      오늘 총 <strong>{stats.todayReviewed}문제</strong> (쉬움 {stats.todayCorrect} /
                      재학습 {stats.todayWrong}) 풀이를 마쳤습니다.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                      <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setActiveTab('add')}
                      >
                        + 단어 추가하기
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
                      {getStateLabel(currentItem.card.state)}
                    </span>
                          <span className="cat-badge">
                      <FolderOpen size={11} />
                            {normalizeCategory(currentItem.tag)}
                    </span>
                        </div>
                        <button
                            type="button"
                            className="icon-circle-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              speakWord(currentItem.word, speechRate);
                            }}
                        >
                          <Volume2 size={19} />
                        </button>
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
                                  <div className="example-box">{currentItem.example}</div>
                              )}
                            </>
                        )}
                      </div>

                      <div className="flip-hint">
                        <RotateCcw size={13} />
                        {!isFlipped
                            ? '카드를 터치해 품사별 뜻 · 반의어 · 예문/해석 보기'
                            : '다시/어려움은 오늘 마지막에 다시 나오고, 보통/쉬움은 다음 복습일로 넘어갑니다'}
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
                    <span className="cat-badge">
                      <FolderOpen size={11} />
                      {normalizeCategory(currentItem.tag)}
                    </span>
                        </div>
                        <button
                            type="button"
                            className="icon-circle-btn"
                            onClick={() => speakWord(currentItem.word, speechRate)}
                        >
                          <Volume2 size={19} />
                        </button>
                      </div>

                      <div className="card-center">
                        <div className="spelling-prompt-label">다음 뜻에 맞는 영어 스펠링을 입력하세요</div>
                        <div className="meaning-display">{currentItem.meaning}</div>

                        {!spellingResult && (
                            <div className="spelling-helpers">
                              <button
                                  type="button"
                                  className="helper-chip"
                                  onClick={() => speakWord(currentItem.word, speechRate)}
                              >
                                <Volume2 size={14} />
                                발음 듣기
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
                                  placeholder="영어 단어 입력..."
                                  value={typedAnswer}
                                  onChange={(e) => setTypedAnswer(e.target.value)}
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  spellCheck={false}
                              />
                              <button type="submit" className="submit-btn">
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
                                  <div className="example-box">{currentItem.example}</div>
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
                              if (currentItem) speakWord(currentItem.word, r);
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

              {/* 3순위 (카드 아래): 폴더/통계 관리 버튼, 폴더 열기, NAS 동기화, 연속 학습일, 남은 복습 */}
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
                      title="NAS n8n 웹훅 설정"
                  >
                    <Server size={15} />
                  </button>
                  {nasWebhookUrl && (
                      <button
                          type="button"
                          className="mini-icon-btn"
                          onClick={() => handleSyncFromNas(false, undefined, false)}
                          title="NAS에서 텔레그램 단어 동기화"
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
                  <div className="due-pill" title="오늘 복습해야 할 남은 단어 수">
                    남은 복습 {dueItems.length}
                  </div>
                </div>
              </div>

              {showNasConfig && (
                  <div className="api-key-box">
                    <div>
                      <strong>NAS n8n Production Webhook 주소</strong>
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
                        🔄 NAS 단어 전체 다시 불러오기
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
                        + 폴더 편집
                      </button>
                    </div>

                    <div className="folder-list">
                      <div className="folder-item-wrap">
                        <button
                            type="button"
                            className={`folder-item ${studyCategory === 'ALL' ? 'active' : ''}`}
                            onClick={() => {
                              setStudyCategory('ALL');
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

                      {folderTree.map((group) => {
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
                                    {group.children.map((child) => {
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

              {/* 4순위 (제일 하단): 버튼 클릭 시에만 펼쳐지는 상세 학습 통계 */}
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
                        <span className="gg-blue">{stats.todayReviewed}문제</span> 풀이 (쉬움{' '}
                        <span className="gg-green">{stats.todayCorrect}</span> / 재복습{' '}
                        <span className="gg-red">{stats.todayWrong}</span>)
                      </div>
                      <div className="gg-stats-line2">
                        [이 문제 전적] 총 {currentCardMetrics.totalTries}전{' '}
                        <span className="gg-green">{currentCardMetrics.wins}승</span>{' '}
                        <span className="gg-red">{currentCardMetrics.losses}패</span> (통산{' '}
                        {currentCardMetrics.winRate}%) &nbsp;|&nbsp; [최근{' '}
                        {currentCardMetrics.recentCount}회]{' '}
                        <span className="gg-green">{currentCardMetrics.recentStr}</span>
                      </div>
                      <div className="gg-stats-line3">
                        평균 시간: {currentCardMetrics.avgSec}초 &nbsp;|&nbsp; 상태: ●{' '}
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
                        placeholder="한국어 뜻 / 반의어 / 파생어"
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
                  placeholder="early - (형) 이른, (부) 일찍 | I often take walks in the early morning."
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

        {activeTab === 'list' && (
            <div className="panel-card">
              <div className="category-strip">
                <button
                    type="button"
                    className={`cat-chip ${listCategory === 'ALL' ? 'active' : ''}`}
                    onClick={() => setListCategory('ALL')}
                >
                  전체 ({items.length})
                </button>
                {allCategories.map((cat) => (
                    <button
                        key={cat}
                        type="button"
                        className={`cat-chip ${listCategory === cat ? 'active' : ''}`}
                        onClick={() => setListCategory(cat)}
                    >
                      {cat} ({getFolderCounts(cat).total})
                    </button>
                ))}
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

              <div className="search-box">
                <Search size={16} />
                <input
                    type="text"
                    className="search-input"
                    placeholder="단어, 뜻, 예문 검색..."
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
                                    setCustomCategories((prev) =>
                                        Array.from(new Set([...prev, norm]))
                                    );
                                    setItems((prev) =>
                                        prev.map((it) =>
                                            it.id === item.id
                                                ? {
                                                  ...it,
                                                  word: editWord.trim(),
                                                  phonetic: editPhonetic.trim() || undefined,
                                                  meaning: editMeaning.trim(),
                                                  example: editExample.trim() || undefined,
                                                  tag: norm,
                                                }
                                                : it
                                        )
                                    );
                                    setEditingId(null);
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
                              </div>
                              <div className="word-row-meaning">{item.meaning}</div>
                              {item.example && (
                                  <div className="word-row-example">{item.example}</div>
                              )}
                              <div className="word-row-meta">
                                전적: {item.itemStats?.wins || 0}승 {item.itemStats?.losses || 0}패 ·
                                다음 복습:{' '}
                                {item.card.due.toLocaleDateString('ko-KR', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </div>
                            </div>
                            <div className="row-actions">
                              <button
                                  type="button"
                                  className="mini-icon-btn"
                                  onClick={() => speakWord(item.word, speechRate)}
                              >
                                <Volume2 size={15} />
                              </button>
                              <button
                                  type="button"
                                  className="mini-icon-btn"
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
                                  onClick={() =>
                                      setItems((prev) => prev.filter((it) => it.id !== item.id))
                                  }
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