import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  FileSpreadsheet,
  UploadCloud,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Folder,
  Layers,
  Sparkles,
  FolderPlus,
  BookOpen,
} from 'lucide-react';
import type { VocabItem } from '../types';
import {
  parseExcelBuffer,
  downloadSampleExcelFile,
  type ExcelParsedItem,
} from '../utils/excelImport';
import { ExcelGuideModal } from './ExcelGuideModal';
import { createNewVocabItem, normalizeCategory, formatFolderSegment } from '../utils/storage';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetCategory: string;
  allCategories: string[];
  existingItems: VocabItem[];
  onImport: (
    newItems: VocabItem[],
    updatedCategories: string[],
    summary: { added: number; updated: number; skipped: number }
  ) => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  targetCategory,
  allCategories,
  existingItems,
  onImport,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ExcelParsedItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 옵션 설정
  const [selectedFolder, setSelectedFolder] = useState<string>(targetCategory || 'Vocabulary Engine');
  const [isNewFolderMode, setIsNewFolderMode] = useState<boolean>(false);
  const [newBookTitle, setNewBookTitle] = useState<string>('');
  const [newUnitName, setNewUnitName] = useState<string>('');

  const [useExcelUnit, setUseExcelUnit] = useState<boolean>(true);
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'overwrite' | 'allow'>('skip');
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 초기 폴더 및 책 이름 설정
  useEffect(() => {
    if (isOpen) {
      const initial = targetCategory || 'Vocabulary Engine';
      setSelectedFolder(initial);
      const bookPart = initial.includes('/') ? initial.split('/')[0] : initial;
      setNewBookTitle(bookPart);
      setNewUnitName('');
      setIsNewFolderMode(false);
    }
  }, [isOpen, targetCategory]);

  // 기존 카테고리 계층 구조 분석
  const existingBookList = useMemo(() => {
    const set = new Set<string>();
    allCategories.forEach((cat) => {
      const book = cat.includes('/') ? cat.split('/')[0] : cat;
      if (book) set.add(book);
    });
    return Array.from(set);
  }, [allCategories]);

  const folderOptions = useMemo(() => {
    const list: { full: string; label: string; depth: number }[] = [];
    allCategories.forEach((cat) => {
      const parts = cat.split('/');
      let current = '';
      parts.forEach((p, depth) => {
        current = current ? `${current}/${p}` : p;
        if (!list.some((item) => item.full === current)) {
          const indent = '\u00A0\u00A0\u00A0'.repeat(depth);
          const icon = depth === 0 ? '📁 ★ ' : '└ ';
          list.push({
            full: current,
            label: `${indent}${icon}${p}`,
            depth,
          });
        }
      });
    });
    return list;
  }, [allCategories]);

  // 최종 기본 목적지 폴더 계산
  const effectiveBaseFolder = useMemo(() => {
    if (isNewFolderMode) {
      const bookClean = normalizeCategory(newBookTitle) || 'Vocabulary Engine';
      const unitClean = formatFolderSegment(newUnitName);
      return unitClean ? `${bookClean}/${unitClean}` : bookClean;
    }
    return normalizeCategory(selectedFolder) || 'Vocabulary Engine';
  }, [isNewFolderMode, newBookTitle, newUnitName, selectedFolder]);

  // 파일 파싱 처리
  const processFile = async (selectedFile: File) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const results = parseExcelBuffer(buffer);
      if (results.length === 0) {
        setErrorMsg('엑셀 파일에서 읽을 수 있는 단어 데이터를 찾지 못했습니다. 양식을 확인해 주세요.');
        setParsedRows([]);
        setFile(null);
      } else {
        setFile(selectedFile);
        setParsedRows(results);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`엑셀 파일을 읽는 중 오류가 발생했습니다: ${err.message || '지원되지 않는 형식'}`);
      setParsedRows([]);
      setFile(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      processFile(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  // 기존 단어 맵 (중복 체크용)
  const existingWordMap = useMemo(() => {
    const map = new Map<string, VocabItem>();
    existingItems.forEach((it) => {
      map.set(it.word.trim().toLowerCase(), it);
    });
    return map;
  }, [existingItems]);

  // 유효 항목과 통계 계산
  const validRows = useMemo(() => parsedRows.filter((r) => r.isValid), [parsedRows]);
  const invalidRows = useMemo(() => parsedRows.filter((r) => !r.isValid), [parsedRows]);

  const stats = useMemo(() => {
    let duplicateCount = 0;
    validRows.forEach((row) => {
      if (existingWordMap.has(row.word.trim().toLowerCase())) {
        duplicateCount += 1;
      }
    });

    let willAdd = 0;
    let willUpdate = 0;
    let willSkip = 0;

    if (duplicateAction === 'skip') {
      willAdd = validRows.length - duplicateCount;
      willSkip = duplicateCount;
    } else if (duplicateAction === 'overwrite') {
      willAdd = validRows.length - duplicateCount;
      willUpdate = duplicateCount;
    } else {
      willAdd = validRows.length;
    }

    return {
      total: parsedRows.length,
      valid: validRows.length,
      invalid: invalidRows.length,
      duplicates: duplicateCount,
      willAdd,
      willUpdate,
      willSkip,
    };
  }, [validRows, invalidRows, parsedRows, existingWordMap, duplicateAction]);

  // 단어 등록 실행
  const handleSubmit = () => {
    if (validRows.length === 0) return;

    const baseFolder = effectiveBaseFolder;

    const updatedCategoriesSet = new Set<string>(allCategories);
    updatedCategoriesSet.add(baseFolder);

    const nowTs = Date.now();
    const newItemsToAdd: VocabItem[] = [];
    const updatedExistingItems = [...existingItems];

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    validRows.forEach((row, idx) => {
      const lowerWord = row.word.trim().toLowerCase();
      const existing = existingWordMap.get(lowerWord);

      // 폴더 결정 (다단계 계층 지원: 기본 폴더 아래에 엑셀 유닛 결합)
      let targetFolder = baseFolder;
      if (useExcelUnit && row.unit) {
        if (row.unit.includes('/')) {
          // 엑셀에 이미 '대분류/중분류/소분류' 형태로 전체 경로가 적혀 있는 경우
          targetFolder = normalizeCategory(row.unit);
        } else {
          // '31강', '레슨01', '제01강', 'Unit 01' 등 유닛명만 있는 경우 -> 선택된 기본 폴더 아래로 자동 분류
          const cleanUnit = formatFolderSegment(row.unit);
          if (cleanUnit) {
            targetFolder = `${baseFolder}/${cleanUnit}`;
          }
        }
      }
      updatedCategoriesSet.add(targetFolder);

      if (existing) {
        if (duplicateAction === 'skip') {
          skippedCount += 1;
          return;
        } else if (duplicateAction === 'overwrite') {
          // 기존 아이템 정보 업데이트 (FSRS 학습 진도는 보존)
          const targetIndex = updatedExistingItems.findIndex((it) => it.id === existing.id);
          if (targetIndex >= 0) {
            updatedExistingItems[targetIndex] = {
              ...updatedExistingItems[targetIndex],
              meaning: row.meaning,
              phonetic: row.phonetic || updatedExistingItems[targetIndex].phonetic,
              example: row.example || updatedExistingItems[targetIndex].example,
              tag: targetFolder,
            };
            updatedCount += 1;
          }
          return;
        }
      }

      // 신규 추가
      const newItem = createNewVocabItem(
        row.word,
        row.meaning,
        row.example,
        new Date(nowTs + idx),
        targetFolder,
        row.phonetic
      );
      newItemsToAdd.push(newItem);
      addedCount += 1;
    });

    const finalItems = [...newItemsToAdd, ...updatedExistingItems];
    onImport(finalItems, Array.from(updatedCategoriesSet), {
      added: addedCount,
      updated: updatedCount,
      skipped: skippedCount,
    });
    handleClose();
  };

  const handleClose = () => {
    setFile(null);
    setParsedRows([]);
    setErrorMsg(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="gg-modal-backdrop" onClick={handleClose}>
      <div className="gg-modal excel-modal" onClick={(e) => e.stopPropagation()}>
        {/* 모달 헤더 */}
        <div className="gg-modal-header">
          <span className="gg-modal-title">
            <FileSpreadsheet size={19} color="#16a34a" />
            엑셀 파일로 단어 일괄 등록
          </span>
          <button type="button" className="mini-icon-btn" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        <div className="excel-modal-body">
          {/* 심플 설명서 안내 바 */}
          <div className="excel-guide-bar">
            <div className="excel-guide-bar-left">
              <Sparkles size={14} color="#eab308" />
              <span>3단계 폴더(시리즈 &gt; 권 &gt; 강) 자동 분류 & 작성법</span>
            </div>
            <div className="excel-guide-bar-actions">
              <button
                type="button"
                className="helper-chip"
                style={{
                  fontSize: '0.72rem',
                  padding: '3px 8px',
                  background: '#fef08a',
                  color: '#854d0e',
                  border: '1px solid #facc15',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                onClick={() => setShowGuideModal(true)}
              >
                📖 설명서 보기
              </button>
              <button
                type="button"
                className="sample-download-btn"
                onClick={downloadSampleExcelFile}
                style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                title="소이 단어장 표준 엑셀 양식 다운로드"
              >
                <Download size={12} />
                양식 다운로드
              </button>
            </div>
          </div>

          {/* 2. 등록 옵션 설정 */}
          <div className="excel-options-box">
            <div className="excel-opt-title">⚙️ 등록 옵션</div>

            {/* 폴더 선택 & 새 폴더 만들기 인터페이스 */}
            <div className="folder-selection-card">
              <div className="folder-selection-header">
                <span className="folder-selection-title">
                  <Folder size={14} color="#eab308" />
                  {isNewFolderMode ? '새 문제집(책) / 단원 폴더 직접 만들기' : '단어가 등록될 기본 폴더 선택'}
                </span>
                <button
                  type="button"
                  className="folder-mode-switch-btn"
                  onClick={() => setIsNewFolderMode((prev) => !prev)}
                >
                  {isNewFolderMode ? (
                    <>
                      <BookOpen size={12} />
                      기존 폴더 목록에서 선택
                    </>
                  ) : (
                    <>
                      <FolderPlus size={12} />
                      + 새 폴더 만들기
                    </>
                  )}
                </button>
              </div>

              {!isNewFolderMode ? (
                <div className="existing-folder-picker">
                  <select
                    className="mini-input folder-select-large"
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value)}
                  >
                    {folderOptions.map((opt) => (
                      <option key={opt.full} value={opt.full}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="folder-tip-text">
                    현재 선택된 기본 폴더: <strong>{effectiveBaseFolder}</strong>
                  </div>
                </div>
              ) : (
                <div className="new-folder-builder">
                  <div className="new-folder-inputs-grid">
                    <div className="new-folder-field">
                      <label className="field-sub-label">1. 책 / 시리즈 제목 (상위 폴더, 필수)</label>
                      <input
                        type="text"
                        className="mini-input"
                        placeholder="예: 영어책이름, 영어책이름/1권, 워드마스터"
                        value={newBookTitle}
                        onChange={(e) => setNewBookTitle(e.target.value)}
                        list="existing-books-datalist"
                      />
                      <datalist id="existing-books-datalist">
                        {existingBookList.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    </div>

                    <div className="new-folder-field">
                      <label className="field-sub-label">2. 하위 권 / 단원 / 강 (선택 사항)</label>
                      <input
                        type="text"
                        className="mini-input"
                        placeholder="예: 1권, 01강, Lesson 01, Unit 01"
                        value={newUnitName}
                        onChange={(e) => setNewUnitName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="new-folder-dest-pill">
                    👉 새로 생성되어 등록될 폴더 경로: <strong>{effectiveBaseFolder}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* 중복 처리 & 자동 분류 체크박스 */}
            <div className="excel-opt-grid">
              <div className="excel-opt-item" style={{ gridColumn: 'span 2' }}>
                <label className="excel-opt-label">
                  <Layers size={13} />
                  이미 등록된 단어 처리 방식
                </label>
                <div className="duplicate-btn-group">
                  <button
                    type="button"
                    className={`dup-btn ${duplicateAction === 'skip' ? 'active' : ''}`}
                    onClick={() => setDuplicateAction('skip')}
                    title="기존 단어를 유지하고 엑셀의 중복 단어는 건너뜁니다."
                  >
                    건너뛰기 (기본)
                  </button>
                  <button
                    type="button"
                    className={`dup-btn ${duplicateAction === 'overwrite' ? 'active' : ''}`}
                    onClick={() => setDuplicateAction('overwrite')}
                    title="기존 단어의 뜻과 예문을 엑셀 내용으로 업데이트합니다 (암기 일정은 보존)."
                  >
                    내용 업데이트
                  </button>
                  <button
                    type="button"
                    className={`dup-btn ${duplicateAction === 'allow' ? 'active' : ''}`}
                    onClick={() => setDuplicateAction('allow')}
                    title="중복 체크 없이 새 카드로 추가합니다."
                  >
                    중복 허용
                  </button>
                </div>
              </div>
            </div>

            <div className="excel-opt-checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={useExcelUnit}
                  onChange={(e) => setUseExcelUnit(e.target.checked)}
                />
                <span>
                  엑셀 파일에 '유닛/폴더' 열이 있으면 해당 단원(<code>레슨01</code>, <code>제01강</code>, <code>1강</code>, <code>Unit 01</code> 등)으로 자동 하위 분류하기
                </span>
              </label>
            </div>
          </div>

          {/* 3. 파일 업로드 드롭존 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {!file ? (
            <div
              className="excel-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <UploadCloud size={36} color="#eab308" />
              <div className="dropzone-main-text">
                엑셀 파일(<code>.xlsx</code>, <code>.xls</code>, <code>.csv</code>)을 이곳에 드래그하거나 클릭하여 선택
              </div>
              <div className="dropzone-sub-text">
                수십, 수백 개의 단어를 한 번에 빠르고 정확하게 등록할 수 있습니다
              </div>
            </div>
          ) : (
            <div className="excel-file-loaded">
              <div className="loaded-file-info">
                <FileSpreadsheet size={24} color="#16a34a" />
                <div className="loaded-file-meta">
                  <div className="loaded-file-name">{file.name}</div>
                  <div className="loaded-file-size">
                    {(file.size / 1024).toFixed(1)} KB · 총 {stats.total}개 행 감지됨
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                  onClick={() => {
                    setFile(null);
                    setParsedRows([]);
                  }}
                >
                  다른 파일 선택
                </button>
              </div>

              {/* 통계 요약 뱃지 */}
              <div className="excel-stats-bar">
                <span className="stat-pill success">
                  <CheckCircle2 size={12} />
                  유효 단어 {stats.valid}개
                </span>
                {stats.duplicates > 0 && (
                  <span className="stat-pill warning">
                    기존 중복 {stats.duplicates}개 (
                    {duplicateAction === 'skip'
                      ? '건너뜀'
                      : duplicateAction === 'overwrite'
                      ? '업데이트'
                      : '추가'}
                    )
                  </span>
                )}
                {stats.invalid > 0 && (
                  <span className="stat-pill danger">
                    <AlertCircle size={12} />
                    오류/누락 행 {stats.invalid}개
                  </span>
                )}
              </div>
            </div>
          )}

          {isLoading && (
            <div className="excel-loading">
              <div className="spin-dot" />
              엑셀 시트에서 단어 목록을 분석하고 있습니다...
            </div>
          )}

          {errorMsg && (
            <div className="excel-error-box">
              <AlertCircle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 4. 인식된 단어 실시간 미리보기 테이블 */}
          {validRows.length > 0 && (
            <div className="excel-preview-box">
              <div className="excel-preview-header">
                <span>미리보기 (상위 {Math.min(5, validRows.length)}개 단어)</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  등록될 단어: <strong>{stats.willAdd}</strong>개 추가
                  {stats.willUpdate > 0 && `, ${stats.willUpdate}개 업데이트`}
                </span>
              </div>

              <div className="excel-preview-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>단어</th>
                      <th>뜻</th>
                      <th>발음</th>
                      <th>예문</th>
                      <th>분류 폴더</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.slice(0, 5).map((row, idx) => {
                      const isDup = existingWordMap.has(row.word.trim().toLowerCase());
                      const parentBook = effectiveBaseFolder.includes('/')
                        ? effectiveBaseFolder.split('/')[0]
                        : effectiveBaseFolder;

                      let targetPreviewFolder = effectiveBaseFolder;
                      if (useExcelUnit && row.unit) {
                        if (row.unit.includes('/')) {
                          targetPreviewFolder = normalizeCategory(row.unit);
                        } else {
                          const cleanUnit = formatFolderSegment(row.unit);
                          if (cleanUnit) targetPreviewFolder = `${parentBook}/${cleanUnit}`;
                        }
                      }

                      return (
                        <tr key={idx}>
                          <td><strong>{row.word}</strong></td>
                          <td>{row.meaning}</td>
                          <td>{row.phonetic || '-'}</td>
                          <td className="cell-truncate" title={row.example}>{row.example || '-'}</td>
                          <td><span className="folder-tag">{targetPreviewFolder}</span></td>
                          <td>
                            {isDup ? (
                              <span className={`badge-pill ${duplicateAction}`}>
                                {duplicateAction === 'skip'
                                  ? '건너뜀'
                                  : duplicateAction === 'overwrite'
                                  ? '업데이트'
                                  : '중복허용'}
                              </span>
                            ) : (
                              <span className="badge-pill new">신규</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {validRows.length > 5 && (
                <div className="preview-more-text">
                  ...외 {validRows.length - 5}개 단어가 함께 등록됩니다.
                </div>
              )}
            </div>
          )}
        </div>

        {/* 모달 푸터 */}
        <div className="excel-modal-footer">
          <button type="button" className="secondary-btn" onClick={handleClose}>
            취소
          </button>
          <button
            type="button"
            className="submit-btn excel-submit"
            disabled={validRows.length === 0}
            onClick={handleSubmit}
          >
            <Sparkles size={15} />
            {stats.willAdd + stats.willUpdate > 0
              ? `총 ${stats.willAdd + stats.willUpdate}개 단어 등록하기`
              : '등록할 단어 없음'}
          </button>
        </div>
      </div>

      {/* 엑셀 3단계 폴더 설명서 팝업창 */}
      <ExcelGuideModal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
      />
    </div>
  );
};
