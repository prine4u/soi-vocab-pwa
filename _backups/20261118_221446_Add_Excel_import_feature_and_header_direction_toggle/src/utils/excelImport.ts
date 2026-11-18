import * as XLSX from 'xlsx';

export interface ExcelParsedItem {
  rawIndex: number;
  word: string;
  meaning: string;
  phonetic?: string;
  example?: string;
  unit?: string;
  isValid: boolean;
  invalidReason?: string;
}

export interface ExcelImportOptions {
  defaultFolder: string;
  useExcelFolder: boolean;
  duplicateHandling: 'skip' | 'overwrite' | 'allow';
}

// 컬럼 헤더 매핑 유틸
function normalizeHeader(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_\-]/g, '');
}

export function parseExcelBuffer(buffer: ArrayBuffer): ExcelParsedItem[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const worksheet = workbook.Sheets[sheetName];

  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
  if (rawRows.length === 0) return [];

  // 헤더 매핑 추론
  const sample = rawRows[0];
  const keys = Object.keys(sample);

  let wordKey = '';
  let meaningKey = '';
  let phoneticKey = '';
  let exampleKey = '';
  let unitKey = '';
  let posKey = '';

  for (const k of keys) {
    const norm = normalizeHeader(k);
    if (['단어', '영단어', '영어', 'word', 'english', 'voca', 'vocab'].includes(norm)) {
      if (!wordKey) wordKey = k;
    } else if (['뜻', '의미', '한글뜻', '해석', 'meaning', 'korean', 'definition'].includes(norm)) {
      if (!meaningKey) meaningKey = k;
    } else if (['발음', '발음기호', 'phonetic', 'pronunciation'].includes(norm)) {
      if (!phoneticKey) phoneticKey = k;
    } else if (['예문', '문장', '예문해석', 'example', 'sentence'].includes(norm)) {
      if (!exampleKey) exampleKey = k;
    } else if (['폴더', '유닛', '단원', 'unit', 'folder', 'chapter', 'category'].includes(norm)) {
      if (!unitKey) unitKey = k;
    } else if (['품사', 'pos', 'partofspeech'].includes(norm)) {
      if (!posKey) posKey = k;
    }
  }

  // 만약 헤더 키를 못 찾았을 경우 순서 기반(A=단어, B=뜻, ...) 추론
  if (!wordKey && keys.length > 0) wordKey = keys[0];
  if (!meaningKey && keys.length > 1) meaningKey = keys[1];
  if (!phoneticKey && keys.length > 2 && keys[2].toLowerCase().includes('phone')) phoneticKey = keys[2];
  if (!exampleKey && keys.length > 3) exampleKey = keys[3];

  const results: ExcelParsedItem[] = [];

  rawRows.forEach((row, idx) => {
    const rawWord = String(row[wordKey] ?? '').trim();
    let rawMeaning = String(row[meaningKey] ?? '').trim();
    const rawPhonetic = phoneticKey ? String(row[phoneticKey] ?? '').trim() : '';
    const rawExample = exampleKey ? String(row[exampleKey] ?? '').trim() : '';
    const rawUnit = unitKey ? String(row[unitKey] ?? '').trim() : '';
    const rawPos = posKey ? String(row[posKey] ?? '').trim() : '';

    if (rawPos && !rawMeaning.startsWith(`[${rawPos}]`) && !rawMeaning.startsWith(`(${rawPos})`)) {
      rawMeaning = `[${rawPos}] ${rawMeaning}`;
    }

    if (!rawWord && !rawMeaning) {
      // 빈 행 건너뜀
      return;
    }

    if (!rawWord) {
      results.push({
        rawIndex: idx + 2,
        word: '',
        meaning: rawMeaning,
        isValid: false,
        invalidReason: '단어가 비어 있습니다.',
      });
      return;
    }

    if (!rawMeaning) {
      results.push({
        rawIndex: idx + 2,
        word: rawWord,
        meaning: '',
        isValid: false,
        invalidReason: '단어의 뜻이 비어 있습니다.',
      });
      return;
    }

    results.push({
      rawIndex: idx + 2,
      word: rawWord,
      meaning: rawMeaning,
      phonetic: rawPhonetic || undefined,
      example: rawExample || undefined,
      unit: rawUnit || undefined,
      isValid: true,
    });
  });

  return results;
}

export function downloadSampleExcelFile() {
  const sampleData = [
    {
      '단어 (Word)': 'early',
      '품사 (POS)': '형용사, 부사',
      '뜻 (Meaning)': '이른, 일찍',
      '발음기호 (Phonetic)': '[ə́ːrli]',
      '예문 (Example)': 'I often take walks in the early morning.',
      '유닛/폴더 (Unit)': 'Unit 01',
    },
    {
      '단어 (Word)': 'curious',
      '품사 (POS)': '형용사',
      '뜻 (Meaning)': '호기심 많은',
      '발음기호 (Phonetic)': '[kjúəriəs]',
      '예문 (Example)': 'Children are naturally curious about the world.',
      '유닛/폴더 (Unit)': '레슨01',
    },
    {
      '단어 (Word)': 'magazine',
      '품사 (POS)': '명사',
      '뜻 (Meaning)': '잡지',
      '발음기호 (Phonetic)': '[mæ̀gəzíːn]',
      '예문 (Example)': 'She bought a fashion magazine at the bookstore.',
      '유닛/폴더 (Unit)': '제01강',
    },
    {
      '단어 (Word)': 'discover',
      '품사 (POS)': '동사',
      '뜻 (Meaning)': '발견하다, 알아내다',
      '발음기호 (Phonetic)': '[diskʌ́vər]',
      '예문 (Example)': 'Scientists discovered a new star last night.',
      '유닛/폴더 (Unit)': '1강',
    },
    {
      '단어 (Word)': 'challenge',
      '품사 (POS)': '명사, 동사',
      '뜻 (Meaning)': '도전, 도전하다',
      '발음기호 (Phonetic)': '[tʃǽlindʒ]',
      '예문 (Example)': 'Learning English is an exciting challenge.',
      '유닛/폴더 (Unit)': '능률 중학/Lesson 01',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  // 컬럼 너비 조정
  worksheet['!cols'] = [
    { wch: 15 }, // 단어
    { wch: 15 }, // 품사
    { wch: 25 }, // 뜻
    { wch: 15 }, // 발음기호
    { wch: 45 }, // 예문
    { wch: 15 }, // 유닛/폴더
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '단어목록_양식');
  XLSX.writeFile(workbook, '소이단어장_엑셀양식_샘플.xlsx');
}
