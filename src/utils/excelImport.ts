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
    const raw = k.trim().toLowerCase();
    const clean = raw.replace(/[\s_\-()[\]/]/g, '');

    // 1. 단어 / 영어 열 감지
    if (!wordKey) {
      if (
        clean.includes('word') ||
        clean.includes('단어') ||
        clean.includes('영단어') ||
        clean.includes('영어') ||
        clean.includes('vocab') ||
        clean.includes('voca') ||
        clean.includes('english')
      ) {
        wordKey = k;
        continue;
      }
    }

    // 2. 품사 (POS) 열 감지
    if (!posKey) {
      if (
        clean.includes('pos') ||
        clean.includes('품사') ||
        clean.includes('partofspeech')
      ) {
        posKey = k;
        continue;
      }
    }

    // 3. 뜻 / 의미 열 감지
    if (!meaningKey) {
      if (
        clean.includes('meaning') ||
        clean.includes('뜻') ||
        clean.includes('의미') ||
        clean.includes('한글뜻') ||
        clean.includes('해석') ||
        clean.includes('korean') ||
        clean.includes('definition')
      ) {
        meaningKey = k;
        continue;
      }
    }

    // 4. 발음기호 열 감지
    if (!phoneticKey) {
      if (
        clean.includes('phonetic') ||
        clean.includes('발음') ||
        clean.includes('발음기호') ||
        clean.includes('pronunciation') ||
        clean.includes('sound')
      ) {
        phoneticKey = k;
        continue;
      }
    }

    // 5. 예문 / 문장 열 감지
    if (!exampleKey) {
      if (
        clean.includes('example') ||
        clean.includes('예문') ||
        clean.includes('문장') ||
        clean.includes('sentence')
      ) {
        exampleKey = k;
        continue;
      }
    }

    // 6. 유닛 / 폴더 / 단원 열 감지
    if (!unitKey) {
      if (
        clean.includes('unit') ||
        clean.includes('유닛') ||
        clean.includes('폴더') ||
        clean.includes('folder') ||
        clean.includes('단원') ||
        clean.includes('강') ||
        clean.includes('chapter') ||
        clean.includes('lesson') ||
        clean.includes('레슨')
      ) {
        unitKey = k;
        continue;
      }
    }
  }

  // 만약 헤더 키를 못 찾았을 경우 스마트 추론:
  // pos, phonetic, example, unit 등으로 이미 지정된 키를 제외하고 남은 키에서 word, meaning 할당
  const reservedKeys = new Set([posKey, phoneticKey, exampleKey, unitKey].filter(Boolean));
  const availableKeys = keys.filter((k) => !reservedKeys.has(k));

  if (!wordKey && availableKeys.length > 0) {
    wordKey = availableKeys[0];
  }
  if (!meaningKey && availableKeys.length > 1) {
    meaningKey = availableKeys[1];
  }

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
      '유닛/폴더 (Unit)': '레슨 01',
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
