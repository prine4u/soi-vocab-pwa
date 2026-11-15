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
  Gauge,
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
  getSampleItems,
  loadStudyStats,
  saveStudyStats,
  incrementTodayReview,
  parseImportedVocab,
  getDateKey,
  DEFAULT_CATEGORY,
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

function formatInterval(due: Date, now: Date): string {
  const diffMs = Math.max(0, due.getTime() - now.getTime());
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return '1분 미만';
  if (diffMin < 60) return `${diffMin}분 뒤`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}시간 뒤`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}일 뒤`;
  const diffMonths = Math.round(diffDays / 30);
  return `${diffMonths}개월 뒤`;
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
      return '학습';
  }
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
  const [speechRate, setSpeechRate] = useState<number>(0.9);
  const [isFolderSidebarOpen, setIsFolderSidebarOpen] = useState<boolean>(true);

  // Category states
  const [studyCategory, setStudyCategory] = useState<string>('ALL');
  const [listCategory, setListCategory] = useState<string>('ALL');
  const [targetCategory, setTargetCategory] = useState<string>(DEFAULT_CATEGORY);
  const [isCreatingCategory, setIsCreatingCategory] = useState<boolean>(false);
  const [newCategoryName, setNewCategoryName] = useState<string>('');

  // Flashcard & Spelling states
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [typedAnswer, setTypedAnswer] = useState<string>('');
  const [spellingResult, setSpellingResult] = useState<'correct' | 'wrong' | null>(null);
  const [showHint, setShowHint] = useState<boolean>(false);
  const spellingInputRef = useRef<HTMLInputElement | null>(null);

  // Add word states
  const [addSubTab, setAddSubTab] = useState<'camera' | 'single' | 'bulk'>('camera');
  const [newWord, setNewWord] = useState<string>('');
  const [newPhonetic, setNewPhonetic] = useState<string>('');
  const [newMeaning, setNewMeaning] = useState<string>('');
  const [newExample, setNewExample] = useState<string>('');
  const [bulkText, setBulkText] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');

  // Camera / OCR states
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => loadGeminiApiKey());
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => loadGeminiApiKey());
  const [showApiKeyEditor, setShowApiKeyEditor] = useState<boolean>(
      () => !loadGeminiApiKey()
  );
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [ocrError, setOcrError] = useState<string>('');
  const [extractedDrafts, setExtractedDrafts] = useState<ExtractedVocabDraft[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // NAS Sync states
  const [nasWebhookUrl, setNasWebhookUrl] = useState<string>(() => loadNasWebhookUrl());
  const [nasUrlInput, setNasUrlInput] = useState<string>(() => loadNasWebhookUrl());
  const [showNasConfig, setShowNasConfig] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Word list filter & inline edit
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWord, setEditWord] = useState<string>('');
  const [editPhonetic, setEditPhonetic] = useState<string>('');
  const [editMeaning, setEditMeaning] = useState<string>('');
  const [editExample, setEditExample] = useState<string>('');
  const [editTag, setEditTag] = useState<string>(DEFAULT_CATEGORY);
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

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg('');
    }, 3200);
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
        setItems((prev) => [...newItems, ...prev]);
        setCustomCategories((prev) => Array.from(new Set([...prev, ...newCategories])));
        showToast(
            `📥 NAS에서 새 단어 ${newItems.length}개(${newCategories.join(', ')})를 가져왔습니다!`
        );
      } else if (!silent) {
        showToast('NAS와 동기화 완료! 새로 추가된 단어가 없습니다.');
      }
    } catch {
      if (!silent) {
        showToast('NAS 연결에 실패했습니다. n8n 웹훅 주소와 Publish 상태를 확인해 주세요.');
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

  const allCategories = useMemo(() => {
    const set = new Set<string>([DEFAULT_CATEGORY, ...customCategories]);
    items.forEach((item) => {
      set.add(normalizeCategory(item.tag));
    });
    return Array.from(set);
  }, [customCategories, items]);

  const totalCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const cat = normalizeCategory(item.tag);
      map.set(cat, (map.get(cat) || 0) + 1);
    });
    return map;
  }, [items]);

  const allDueItems = useMemo(() => {
    const now = new Date();
    const endOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999
    ).getTime();

    return items
        .filter((item) => item.card.due.getTime() <= endOfToday)
        .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
  }, [items]);

  const dueItems = useMemo(() => {
    if (studyCategory === 'ALL') return allDueItems;
    return allDueItems.filter(
        (item) => normalizeCategory(item.tag) === studyCategory
    );
  }, [allDueItems, studyCategory]);

  const dueCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    allDueItems.forEach((item) => {
      const cat = normalizeCategory(item.tag);
      map.set(cat, (map.get(cat) || 0) + 1);
    });
    return map;
  }, [allDueItems]);

  const currentItem = dueItems[0] ?? null;

  const speakWord = (text: string, customRate?: number) => {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = 'en-US';
    utterance.rate = customRate ?? speechRate;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (
        activeTab === 'study' &&
        studyMode === 'flashcard' &&
        autoSpeak &&
        currentItem &&
        !isFlipped
    ) {
      speakWord(currentItem.word);
    }
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
  };

  const handleCreateCategory = () => {
    const cleaned = newCategoryName.trim();
    if (!cleaned) return;
    setCustomCategories((prev) => Array.from(new Set([...prev, cleaned])));
    setTargetCategory(cleaned);
    setStudyCategory(cleaned);
    setNewCategoryName('');
    setIsCreatingCategory(false);
    showToast(`"${cleaned}" 폴더가 생성되었습니다.`);
  };

  const handleDeleteCategory = (catName: string) => {
    const count = totalCountByCategory.get(catName) || 0;
    const msg =
        count > 0
            ? `[${catName}] 학습장 폴더와 안에 들어있는 단어 ${count}개를 모두 삭제하시겠습니까?`
            : `[${catName}] 빈 폴더를 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;

    setItems((prev) => prev.filter((item) => normalizeCategory(item.tag) !== catName));
    setCustomCategories((prev) => prev.filter((c) => c !== catName));
    if (studyCategory === catName) setStudyCategory('ALL');
    if (listCategory === catName) setListCategory('ALL');
    if (targetCategory === catName) setTargetCategory(DEFAULT_CATEGORY);
    showToast(`[${catName}] 폴더가 삭제되었습니다.`);
  };

  const handleRate = (grade: Grade) => {
    if (!currentItem) return;
    const now = new Date();
    const record = scheduler.repeat(currentItem.card, now)[grade];

    setItems((prev) =>
        prev.map((item) =>
            item.id === currentItem.id ? { ...item, card: record.card } : item
        )
    );
    setStats((prev) => incrementTodayReview(prev));
    resetCardInteraction();
  };

  const handleCheckSpelling = (e: FormEvent) => {
    e.preventDefault();
    if (!currentItem || !typedAnswer.trim()) return;

    const normalizedInput = typedAnswer.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedTarget = currentItem.word.trim().replace(/\s+/g, ' ').toLowerCase();
    const isCorrect = normalizedInput === normalizedTarget;

    setSpellingResult(isCorrect ? 'correct' : 'wrong');
    speakWord(currentItem.word);
  };

  const handleSaveApiKey = () => {
    saveGeminiApiKey(apiKeyInput);
    const saved = loadGeminiApiKey();
    setGeminiApiKey(saved);
    if (saved) {
      setShowApiKeyEditor(false);
      showToast('Gemini API 키가 저장되었습니다.');
    } else {
      showToast('API 키가 삭제되었습니다.');
    }
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
        setOcrError('사진에서 영어 단어를 찾지 못했습니다. 글자가 선명하게 나오도록 다시 찍어보세요.');
      } else {
        const now = Date.now();
        setExtractedDrafts(
            extracted.map((item, idx) => ({
              id: `draft-${now}-${idx}`,
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
      field: 'word' | 'phonetic' | 'meaning' | 'example' | 'selected',
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
    if (selectedItems.length === 0) {
      showToast('저장할 단어를 1개 이상 선택해 주세요.');
      return;
    }

    const now = Date.now();
    const created = selectedItems.map((draft, idx) =>
        createNewVocabItem(
            draft.word,
            draft.meaning,
            draft.example,
            new Date(now + idx),
            targetCategory,
            draft.phonetic
        )
    );

    setItems((prev) => [...created, ...prev]);
    setExtractedDrafts([]);
    showToast(`[${targetCategory}]에 ${created.length}개 단어가 한 번에 저장되었습니다.`);
  };

  const handleAddSingle = (e: FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !newMeaning.trim()) return;

    const created = createNewVocabItem(
        newWord,
        newMeaning,
        newExample,
        new Date(),
        targetCategory,
        newPhonetic
    );
    setItems((prev) => [created, ...prev]);
    setNewWord('');
    setNewPhonetic('');
    setNewMeaning('');
    setNewExample('');
    showToast(`[${targetCategory}]에 "${created.word}" 단어가 추가되었습니다.`);
  };

  const handleAddBulk = () => {
    const lines = bulkText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return;

    const added: VocabItem[] = [];
    const now = Date.now();

    lines.forEach((line, idx) => {
      const [mainPart, examplePart] = line.split('|').map((part) => part.trim());
      const match = mainPart.match(/^(.+?)(?:\t|\s+-\s+|\s*[:=]\s*|\s*,\s*)(.+)$/);
      if (match) {
        const word = match[1].trim();
        const meaning = match[2].trim();
        if (word && meaning) {
          added.push(
              createNewVocabItem(word, meaning, examplePart, new Date(now + idx), targetCategory)
          );
        }
      }
    });

    if (added.length === 0) {
      showToast('인식된 단어가 없습니다. "단어 - 뜻" 형식을 확인해 주세요.');
      return;
    }

    setItems((prev) => [...added, ...prev]);
    setBulkText('');
    showToast(`[${targetCategory}]에 ${added.length}개 단어가 등록되었습니다.`);
  };

  const handleDeleteItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const startEditing = (item: VocabItem) => {
    setEditingId(item.id);
    setEditWord(item.word);
    setEditPhonetic(item.phonetic ?? '');
    setEditMeaning(item.meaning);
    setEditExample(item.example ?? '');
    setEditTag(normalizeCategory(item.tag));
  };

  const saveEditing = (id: string) => {
    if (!editWord.trim() || !editMeaning.trim()) return;
    setItems((prev) =>
        prev.map((item) =>
            item.id === id
                ? {
                  ...item,
                  word: editWord.trim(),
                  phonetic: editPhonetic.trim() || undefined,
                  meaning: editMeaning.trim(),
                  example: editExample.trim() || undefined,
                  tag: normalizeCategory(editTag),
                }
                : item
        )
    );
    setEditingId(null);
    showToast('단어 정보가 수정되었습니다.');
  };

  const handleLoadSamples = () => {
    const existingWords = new Set(items.map((item) => item.word.toLowerCase()));
    const freshSamples = getSampleItems().filter(
        (sample) => !existingWords.has(sample.word.toLowerCase())
    );
    if (freshSamples.length === 0) {
      showToast('기본 샘플 단어가 이미 모두 등록되어 있습니다.');
      return;
    }
    setItems((prev) => [...freshSamples, ...prev]);
    showToast(`샘플 단어 ${freshSamples.length}개를 추가했습니다.`);
  };

  const handleExportJson = () => {
    const payload = {
      app: 'Soi Vocab',
      version: 3,
      exportedAt: new Date().toISOString(),
      categories: allCategories,
      items,
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
    showToast('단어장 백업 파일(JSON)을 저장했습니다.');
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseImportedVocab(text);
      if (imported.length === 0) {
        showToast('불러올 수 있는 유효한 단어가 없습니다.');
        return;
      }

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
      const matchCategory =
          listCategory === 'ALL' || normalizeCategory(item.tag) === listCategory;
      if (!matchCategory) return false;
      if (!q) return true;
      return (
          item.word.toLowerCase().includes(q) ||
          item.meaning.toLowerCase().includes(q) ||
          (item.example && item.example.toLowerCase().includes(q))
      );
    });
  }, [items, searchQuery, listCategory]);

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
          label: '다시',
          className: 'rate-again',
          intervalText: formatInterval(scheduling[Rating.Again].card.due, now),
        },
        {
          grade: Rating.Hard,
          label: '어려움',
          className: 'rate-hard',
          intervalText: formatInterval(scheduling[Rating.Hard].card.due, now),
        },
        {
          grade: Rating.Good,
          label: '보통',
          className: 'rate-good',
          intervalText: formatInterval(scheduling[Rating.Good].card.due, now),
        },
        {
          grade: Rating.Easy,
          label: '쉬움',
          className: 'rate-easy',
          intervalText: formatInterval(scheduling[Rating.Easy].card.due, now),
        },
      ]
      : [];

  const getSpellingHint = (word: string) => {
    const clean = word.trim();
    if (clean.length <= 1) return clean;
    return `${clean[0]} ${'_ '.repeat(clean.length - 1).trim()} (${clean.length}글자)`;
  };

  const totalTodayTarget = stats.todayReviewed + allDueItems.length;
  const progressPercent =
      totalTodayTarget === 0
          ? 100
          : Math.min(100, Math.round((stats.todayReviewed / totalTodayTarget) * 100));

  const selectedDraftCount = extractedDrafts.filter((d) => d.selected).length;

  return (
      <div className="app-shell">
        <header className="app-header">
          <div>
            <h1 className="app-title">Soi Vocab</h1>
            <p className="app-subtitle">전체 {items.length}단어 · FSRS 망각곡선 복습</p>
          </div>
          <div className="header-badges">
            <button
                type="button"
                className="mini-icon-btn"
                onClick={() => setIsFolderSidebarOpen((prev) => !prev)}
                title={isFolderSidebarOpen ? '왼쪽 폴더 메뉴 접기' : '왼쪽 폴더 메뉴 열기'}
            >
              {isFolderSidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
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
                    title="NAS에서 텔레그램 단어 가져오기"
                >
                  <RefreshCw size={15} className={isSyncing ? 'spin' : ''} />
                </button>
            )}
            <div className="streak-pill" title="연속 학습일">
              <Flame size={14} />
              {stats.streak}일째
            </div>
            <div className="due-pill">남은 복습 {dueItems.length}</div>
          </div>
        </header>

        {showNasConfig && (
            <div className="api-key-box">
              <div>
                <strong>NAS n8n Production Webhook 주소</strong> (텔레그램 스캔 단어 자동 동기화)
              </div>
              <div className="api-key-row">
                <input
                    type="url"
                    className="mini-input"
                    style={{ flex: 1 }}
                    placeholder="https://prine4u.myds.me:8443/webhook/soi-vocab-inbox"
                    value={nasUrlInput}
                    onChange={(e) => setNasUrlInput(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                />
                <button
                    type="button"
                    className="submit-btn"
                    style={{ padding: '7px 12px', fontSize: '0.8rem' }}
                    onClick={handleSaveNasWebhook}
                >
                  주소 저장
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                    type="button"
                    className="secondary-btn"
                    style={{ fontSize: '0.76rem', padding: '6px 10px' }}
                    onClick={() => handleSyncFromNas(false, nasUrlInput, true)}
                >
                  🔄 NAS 단어 전체 다시 불러오기
                </button>
                <button
                    type="button"
                    className="secondary-btn"
                    style={{ fontSize: '0.76rem', padding: '6px 10px', color: '#dc2626' }}
                    onClick={handleClearNasRemote}
                >
                  🗑️ NAS 대기열 비우기
                </button>
              </div>
            </div>
        )}

        {toastMsg && activeTab === 'study' && <div className="toast-banner">{toastMsg}</div>}

        {activeTab === 'study' && (
            <div className={`study-layout ${isFolderSidebarOpen ? '' : 'sidebar-collapsed'}`}>
              {/* 카드 왼쪽 폴더형 학습장 선택 메뉴 */}
              {isFolderSidebarOpen && (
                  <aside className="folder-sidebar">
                    <div className="folder-sidebar-header">
                <span className="folder-sidebar-title">
                  <FolderOpen size={15} />
                  학습장 폴더
                </span>
                      <button
                          type="button"
                          className="helper-chip"
                          style={{ padding: '3px 7px', fontSize: '0.7rem' }}
                          onClick={() => setIsCreatingCategory((prev) => !prev)}
                      >
                        {isCreatingCategory ? '취소' : '+ 폴더'}
                      </button>
                    </div>

                    {isCreatingCategory && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <input
                              type="text"
                              className="mini-input"
                              placeholder="새 학습장 이름..."
                              value={newCategoryName}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                          />
                          <button
                              type="button"
                              className="submit-btn"
                              style={{ padding: '6px', fontSize: '0.78rem' }}
                              onClick={handleCreateCategory}
                          >
                            폴더 만들기
                          </button>
                        </div>
                    )}

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
                      {studyCategory === 'ALL' ? (
                          <FolderOpen size={15} />
                      ) : (
                          <Folder size={15} />
                      )}
                      <span className="folder-name">전체 단어장</span>
                    </span>
                          <span className="folder-count">
                      {allDueItems.length}/{items.length}
                    </span>
                        </button>
                      </div>

                      {allCategories.map((cat) => {
                        const dueCount = dueCountByCategory.get(cat) || 0;
                        const totalCount = totalCountByCategory.get(cat) || 0;
                        const isActive = studyCategory === cat;
                        return (
                            <div key={cat} className="folder-item-wrap">
                              <button
                                  type="button"
                                  className={`folder-item ${isActive ? 'active' : ''}`}
                                  onClick={() => {
                                    setStudyCategory(cat);
                                    setTargetCategory(cat);
                                    resetCardInteraction();
                                  }}
                                  title={`${cat} (복습 ${dueCount} / 전체 ${totalCount})`}
                              >
                        <span className="folder-item-left">
                          {isActive ? <FolderOpen size={15} /> : <Folder size={15} />}
                          <span className="folder-name">{cat}</span>
                        </span>
                                <span className="folder-count">
                          {dueCount}/{totalCount}
                        </span>
                              </button>
                              {cat !== DEFAULT_CATEGORY && (
                                  <button
                                      type="button"
                                      className="folder-del-btn"
                                      title="이 폴더 삭제"
                                      onClick={() => handleDeleteCategory(cat)}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                              )}
                            </div>
                        );
                      })}
                    </div>
                  </aside>
              )}

              {/* 오른쪽 학습 카드 영역 */}
              <div className="study-main">
                <div className="progress-wrap">
                  <div className="progress-top">
                <span>
                  {studyCategory === 'ALL' ? '전체 학습장' : `[${studyCategory}]`} · 오늘 완료{' '}
                  {stats.todayReviewed}회
                </span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>

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
                    <button
                        type="button"
                        className={`auto-audio-btn ${speechRate < 0.8 ? 'on' : ''}`}
                        onClick={() => {
                          const nextRate = speechRate === 0.9 ? 0.65 : 0.9;
                          setSpeechRate(nextRate);
                          if (currentItem) speakWord(currentItem.word, nextRate);
                        }}
                        title="발음 속도 전환"
                    >
                      <Gauge size={14} />
                      {speechRate === 0.9 ? '0.9x' : '0.65x'}
                    </button>

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

                {!currentItem ? (
                    <div className="done-card">
                      <div className="done-icon">
                        <Sparkles size={26} />
                      </div>
                      <h2 className="done-title">
                        {studyCategory === 'ALL'
                            ? '오늘 복습할 단어를 모두 마쳤어요!'
                            : `[${studyCategory}] 복습을 모두 마쳤어요!`}
                      </h2>
                      <p className="done-desc">
                        오늘 총 <strong>{stats.todayReviewed}회</strong> 복습을 완료했습니다.
                        <br />
                        {studyCategory !== 'ALL' && allDueItems.length > 0
                            ? `왼쪽 폴더 메뉴에서 다른 학습장(${allDueItems.length}개 남음)을 선택해 보세요.`
                            : '텔레그램에 단어장 사진을 올리거나 새 단어를 추가해 보세요.'}
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {studyCategory !== 'ALL' && allDueItems.length > 0 && (
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
                            onClick={() => handleSyncFromNas(false, undefined, false)}
                        >
                          📥 NAS 동기화
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
                              aria-label="발음 듣기"
                              onClick={(e) => {
                                e.stopPropagation();
                                speakWord(currentItem.word);
                              }}
                          >
                            <Volume2 size={20} />
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
                          <RotateCcw size={14} />
                          {!isFlipped
                              ? '카드를 터치해 품사별 뜻 · 반의어 · 예문/해석 보기'
                              : '카드를 터치해 뜻 접기'}
                        </div>
                      </div>

                      {isFlipped && (
                          <div className="rating-section">
                            <p className="rating-guide">기억난 정도를 선택하면 다음 복습일이 자동 계산됩니다</p>
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                              aria-label="발음 듣기"
                              onClick={() => speakWord(currentItem.word)}
                          >
                            <Volume2 size={20} />
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
                                    onClick={() => speakWord(currentItem.word)}
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
                                  {showHint ? '힌트 숨기기' : '첫 글자 힌트'}
                                </button>
                              </div>
                          )}

                          {showHint && !spellingResult && (
                              <div className="hint-text">{getSpellingHint(currentItem.word)}</div>
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
                                    autoComplete="off"
                                    spellCheck={false}
                                    enterKeyHint="done"
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
                                  {spellingResult === 'wrong' && (
                                      <div>
                                        입력한 답:{' '}
                                        <span style={{ textDecoration: 'line-through' }}>{typedAnswer}</span>
                                      </div>
                                  )}
                                  <div>
                                    정답: <strong>{currentItem.word}</strong>{' '}
                                    {currentItem.phonetic && <span>{currentItem.phonetic}</span>}
                                  </div>
                                </div>
                                {currentItem.example && (
                                    <div className="example-box">{currentItem.example}</div>
                                )}
                              </div>
                          )}
                        </div>

                        <div className="flip-hint">
                          {!spellingResult
                              ? 'Enter 또는 확인 버튼을 눌러 채점하세요'
                              : '아래에서 난이도를 선택해 다음 단어로 넘어가세요'}
                        </div>
                      </div>

                      {spellingResult && (
                          <div className="rating-section">
                            <p className="rating-guide">
                              {spellingResult === 'correct'
                                  ? '체감 난이도를 선택하세요 (추천: 보통 또는 쉬움)'
                                  : '틀린 단어는 "다시"를 눌러 오늘 한 번 더 복습하세요'}
                            </p>
                            <div className="rating-grid">
                              {ratingOptions.map((opt) => {
                                const isRecommended =
                                    (spellingResult === 'wrong' && opt.grade === Rating.Again) ||
                                    (spellingResult === 'correct' && opt.grade === Rating.Good);
                                return (
                                    <button
                                        key={opt.grade}
                                        type="button"
                                        className={`rate-btn ${opt.className} ${
                                            isRecommended ? 'recommended' : ''
                                        }`}
                                        onClick={() => handleRate(opt.grade)}
                                    >
                                      <span className="rate-label">{opt.label}</span>
                                      <span className="rate-interval">{opt.intervalText}</span>
                                    </button>
                                );
                              })}
                            </div>
                          </div>
                      )}
                    </>
                )}
              </div>
            </div>
        )}

        {activeTab === 'add' && (
            <div className="panel-card">
              <div className="category-select-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                  className="field-label"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <FolderOpen size={14} />
                저장할 학습장 폴더 선택
              </span>
                  <button
                      type="button"
                      className="helper-chip"
                      style={{ padding: '4px 9px', fontSize: '0.74rem' }}
                      onClick={() => setIsCreatingCategory((prev) => !prev)}
                  >
                    {isCreatingCategory ? '취소' : '+ 새 학습장'}
                  </button>
                </div>

                {isCreatingCategory ? (
                    <div className="category-select-row">
                      <input
                          type="text"
                          className="mini-input"
                          placeholder="예: Unit 09, 능률보카 Day 1..."
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                      />
                      <button
                          type="button"
                          className="submit-btn"
                          style={{ padding: '0 14px', fontSize: '0.84rem' }}
                          onClick={handleCreateCategory}
                      >
                        생성
                      </button>
                    </div>
                ) : (
                    <select
                        className="select-input"
                        value={targetCategory}
                        onChange={(e) => setTargetCategory(e.target.value)}
                    >
                      {allCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                      ))}
                    </select>
                )}
              </div>

              <div className="sub-tabs-3">
                <button
                    type="button"
                    className={`sub-tab-btn ${addSubTab === 'camera' ? 'active' : ''}`}
                    onClick={() => setAddSubTab('camera')}
                >
                  사진 스캔 (여러 장 가능)
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

              {toastMsg && <div className="toast-banner">{toastMsg}</div>}

              {addSubTab === 'camera' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                  {geminiApiKey ? 'Gemini AI 연결됨' : 'AI 사진 인식을 위해 API 키가 필요합니다'}
                </span>
                      <button
                          type="button"
                          className="helper-chip"
                          style={{ padding: '4px 9px', fontSize: '0.74rem' }}
                          onClick={() => setShowApiKeyEditor((prev) => !prev)}
                      >
                        <KeyRound size={12} />
                        {showApiKeyEditor ? '닫기' : 'API 키 설정'}
                      </button>
                    </div>

                    {showApiKeyEditor && (
                        <div className="api-key-box">
                          <div>
                            Google AI Studio에서 발급받은 <strong>Gemini API 키</strong>를 입력하면
                            여러 장의 단어장 사진에서 발음기호·다중 뜻·예문/번역을 한 번에 추출합니다.
                          </div>
                          <div className="api-key-row">
                            <input
                                type="password"
                                className="mini-input"
                                style={{ flex: 1 }}
                                placeholder="AIzaSy..."
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                            />
                            <button
                                type="button"
                                className="submit-btn"
                                style={{ padding: '7px 14px', fontSize: '0.82rem' }}
                                onClick={handleSaveApiKey}
                            >
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
                        onClick={() => {
                          if (!geminiApiKey) {
                            setShowApiKeyEditor(true);
                            setOcrError('먼저 위 입력창에 Gemini API 키를 저장해 주세요.');
                            return;
                          }
                          cameraInputRef.current?.click();
                        }}
                    >
                      <Camera size={28} />
                      <span>단어장 사진 찍기 또는 여러 장 한꺼번에 선택</span>
                      <span style={{ fontSize: '0.76rem', fontWeight: 500, opacity: 0.85 }}>
                  3장짜리 유닛도 한 번에 선택하면 발음기호·품사별 뜻·반의어·예문·해석까지 모두 추출됩니다
                </span>
                    </button>

                    {isExtracting && (
                        <div className="ocr-loading">
                          <Loader2 size={18} className="spin" />
                          AI가 선택한 사진들에서 단어·발음기호·다중 뜻·예문/번역을 추출하고 있습니다...
                        </div>
                    )}

                    {ocrError && <div className="ocr-error">{ocrError}</div>}

                    {extractedDrafts.length > 0 && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ fontSize: '0.88rem' }}>
                              추출된 단어 ({selectedDraftCount}/{extractedDrafts.length}개 선택)
                            </strong>
                            <button
                                type="button"
                                className="helper-chip"
                                style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                                onClick={() => setExtractedDrafts([])}
                            >
                              초기화
                            </button>
                          </div>

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
                                    {draft.selected ? <CheckSquare size={19} /> : <Square size={19} />}
                                  </button>
                                  <div className="draft-inputs">
                                    <div className="draft-input-grid">
                                      <input
                                          type="text"
                                          className="mini-input"
                                          value={draft.word}
                                          onChange={(e) =>
                                              handleUpdateDraft(draft.id, 'word', e.target.value)
                                          }
                                          placeholder="영어 단어"
                                          autoCapitalize="none"
                                          autoCorrect="off"
                                      />
                                      <input
                                          type="text"
                                          className="mini-input"
                                          value={draft.phonetic}
                                          onChange={(e) =>
                                              handleUpdateDraft(draft.id, 'phonetic', e.target.value)
                                          }
                                          placeholder="발음기호 [ə́ːrli]"
                                      />
                                    </div>
                                    <textarea
                                        className="mini-input"
                                        rows={2}
                                        value={draft.meaning}
                                        onChange={(e) =>
                                            handleUpdateDraft(draft.id, 'meaning', e.target.value)
                                        }
                                        placeholder="한국어 뜻 / 반의어 / 파생어"
                                    />
                                    <textarea
                                        className="mini-input"
                                        rows={3}
                                        value={draft.example}
                                        onChange={(e) =>
                                            handleUpdateDraft(draft.id, 'example', e.target.value)
                                        }
                                        placeholder="예문 및 한글 번역"
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
                            선택한 {selectedDraftCount}개를 [{targetCategory}] 폴더에 한 번에 저장
                          </button>
                        </>
                    )}
                  </>
              )}

              {addSubTab === 'single' && (
                  <form
                      onSubmit={handleAddSingle}
                      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                  >
                    <div className="draft-input-grid">
                      <div className="field-group">
                        <label className="field-label">영어 단어 *</label>
                        <input
                            type="text"
                            className="text-input"
                            placeholder="예: early"
                            value={newWord}
                            onChange={(e) => setNewWord(e.target.value)}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            required
                        />
                      </div>
                      <div className="field-group">
                        <label className="field-label">발음기호 (선택)</label>
                        <input
                            type="text"
                            className="text-input"
                            placeholder="예: [ə́ːrli]"
                            value={newPhonetic}
                            onChange={(e) => setNewPhonetic(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="field-group">
                      <label className="field-label">한국어 뜻 · 반의어 · 파생어 (여러 줄 가능) *</label>
                      <textarea
                          className="bulk-textarea"
                          style={{ minHeight: 80 }}
                          placeholder={`(형) 이른\n(부) 일찍\n[반] late (형) 늦은 (부) 늦게`}
                          value={newMeaning}
                          onChange={(e) => setNewMeaning(e.target.value)}
                          required
                      />
                    </div>

                    <div className="field-group">
                      <label className="field-label">예문 및 한글 번역 (여러 줄 가능)</label>
                      <textarea
                          className="bulk-textarea"
                          style={{ minHeight: 90 }}
                          placeholder={`I often take walks in the early morning.\n나는 이른 아침에 자주 산책을 한다.`}
                          value={newExample}
                          onChange={(e) => setNewExample(e.target.value)}
                      />
                    </div>

                    <button type="submit" className="primary-full-btn">
                      [{targetCategory}]에 추가하기
                    </button>
                  </form>
              )}

              {addSubTab === 'bulk' && (
                  <>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
                      한 줄에 한 단어씩 <strong>단어 - 뜻 | 예문</strong> 형식으로 붙여넣으세요.
                    </div>

                    <textarea
                        className="bulk-textarea"
                        placeholder={`early - (형) 이른, (부) 일찍 | I often take walks in the early morning.`}
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />

                    <button type="button" className="primary-full-btn" onClick={handleAddBulk}>
                      [{targetCategory}]에 한 번에 등록하기
                    </button>
                  </>
              )}
            </div>
        )}

        {activeTab === 'list' && (
            <div className="panel-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.95rem' }}>
                  단어 목록 ({filteredList.length} / {items.length}개)
                </strong>
                <button type="button" className="secondary-btn" onClick={handleLoadSamples}>
                  샘플 10개 채우기
                </button>
              </div>

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
                      {cat} ({totalCountByCategory.get(cat) || 0})
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

              {toastMsg && <div className="toast-banner">{toastMsg}</div>}

              <div className="search-box">
                <Search size={16} />
                <input
                    type="text"
                    className="search-input"
                    placeholder="영어 단어, 뜻, 예문 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="word-list">
                {filteredList.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.88rem', padding: '20px 0' }}>
                      표시할 단어가 없습니다.
                    </p>
                ) : (
                    filteredList.map((item) => (
                        <div key={item.id} className="word-row">
                          {editingId === item.id ? (
                              <div className="edit-box">
                                <select
                                    className="select-input"
                                    value={editTag}
                                    onChange={(e) => setEditTag(e.target.value)}
                                >
                                  {allCategories.map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat}
                                      </option>
                                  ))}
                                </select>
                                <div className="draft-input-grid">
                                  <input
                                      type="text"
                                      className="text-input"
                                      value={editWord}
                                      onChange={(e) => setEditWord(e.target.value)}
                                      placeholder="영어 단어"
                                      autoCapitalize="none"
                                      autoCorrect="off"
                                  />
                                  <input
                                      type="text"
                                      className="text-input"
                                      value={editPhonetic}
                                      onChange={(e) => setEditPhonetic(e.target.value)}
                                      placeholder="발음기호 [ə́ːrli]"
                                  />
                                </div>
                                <textarea
                                    className="bulk-textarea"
                                    style={{ minHeight: 75 }}
                                    value={editMeaning}
                                    onChange={(e) => setEditMeaning(e.target.value)}
                                    placeholder="한국어 뜻 / 반의어 / 파생어"
                                />
                                <textarea
                                    className="bulk-textarea"
                                    style={{ minHeight: 85 }}
                                    value={editExample}
                                    onChange={(e) => setEditExample(e.target.value)}
                                    placeholder="예문 및 한글 번역"
                                />
                                <div className="edit-actions">
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
                                      style={{ padding: '8px 14px' }}
                                      onClick={() => saveEditing(item.id)}
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
                                    {getStateLabel(item.card.state)} · 다음 복습:{' '}
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
                                      aria-label="발음 듣기"
                                      onClick={() => speakWord(item.word)}
                                  >
                                    <Volume2 size={16} />
                                  </button>
                                  <button
                                      type="button"
                                      className="mini-icon-btn"
                                      aria-label="단어 수정"
                                      onClick={() => startEditing(item)}
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <button
                                      type="button"
                                      className="mini-icon-btn danger"
                                      aria-label="단어 삭제"
                                      onClick={() => handleDeleteItem(item.id)}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </>
                          )}
                        </div>
                    ))
                )}
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
              <BookOpen size={20} />
              학습하기 ({dueItems.length})
            </button>
            <button
                type="button"
                className={`nav-item ${activeTab === 'add' ? 'active' : ''}`}
                onClick={() => setActiveTab('add')}
            >
              <Plus size={20} />
              단어 추가
            </button>
            <button
                type="button"
                className={`nav-item ${activeTab === 'list' ? 'active' : ''}`}
                onClick={() => setActiveTab('list')}
            >
              <List size={20} />
              단어 목록
            </button>
          </div>
        </nav>
      </div>
  );
}

export default App;