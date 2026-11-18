import React from 'react';
import {
  FileSpreadsheet,
  X,
  Download,
  Sparkles,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { downloadSampleExcelFile } from '../utils/excelImport';

interface ExcelGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExcelGuideModal: React.FC<ExcelGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="guide-modal-backdrop" onClick={onClose}>
      <div className="guide-modal" onClick={(e) => e.stopPropagation()}>
        {/* 모달 헤더 */}
        <div className="guide-modal-header">
          <span className="guide-modal-title">
            <FileSpreadsheet size={20} color="#16a34a" />
            엑셀 작성법 & 3단계 폴더 분류 설명서
          </span>
          <button type="button" className="mini-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* 1. 3단계 폴더 자동 분류 2가지 방법 */}
        <div className="guide-section highlight">
          <div className="guide-section-title">
            <Sparkles size={16} color="#eab308" />
            <span>엑셀로 3단계 폴더(시리즈 ➔ 권 ➔ 강) 자동 분류하는 2가지 방법</span>
          </div>

          <div className="guide-step-grid">
            {/* 방법 1 */}
            <div className="guide-step-item">
              <span className="guide-step-badge yellow">방법 ① 추천!</span>
              <div className="guide-step-body">
                <div><strong>기본 폴더 선택 + 엑셀 유닛 열 활용 (가장 쉬운 방법)</strong></div>
                <div style={{ marginTop: 4, color: '#475569' }}>
                  1. 엑셀 업로드 창의 <strong>[단어가 등록될 기본 폴더]</strong>에서 <code>영어책이름/1권</code> (또는 <code>책이름/1권</code>)을 선택합니다.<br />
                  2. 엑셀 파일의 <strong>'유닛/폴더'</strong> 열에는 <code>01강</code>, <code>02강</code>처럼 단원 번호만 적습니다.<br />
                  👉 <strong>결과:</strong> 자동으로 <code>★ 영어책이름 &gt; 1권 &gt; 01강</code>으로 3단계 자동 분류되어 들어갑니다!
                </div>
              </div>
            </div>

            {/* 방법 2 */}
            <div className="guide-step-item">
              <span className="guide-step-badge">방법 ②</span>
              <div className="guide-step-body">
                <div><strong>엑셀 '유닛/폴더' 열에 전체 경로 직접 입력 (파일 1개로 여러 권 한 번에!)</strong></div>
                <div style={{ marginTop: 4, color: '#475569' }}>
                  엑셀의 '유닛/폴더' 열에 슬래시(<code>/</code>)를 넣어 전체 경로를 직접 적어둡니다:<br />
                  • <code>영어책이름/1권/01강</code><br />
                  • <code>영어책이름/1권/02강</code><br />
                  • <code>영어책이름/2권/01강</code><br />
                  👉 <strong>결과:</strong> 엑셀 파일 하나만 올려도 1권, 2권 등 각 권의 강별로 3단계 폴더가 쏙쏙 자동 생성되어 분류됩니다!
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. 엑셀 열(헤더) 작성 규칙 및 표 예시 */}
        <div className="guide-section">
          <div className="guide-section-title">
            <Layers size={15} color="#0284c7" />
            <span>엑셀 열(헤더) 작성 형식 및 예시</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
            엑셀 첫 번째 행에 열 이름을 넣고 작성해 주세요. (지원 파일: <code>.xlsx</code>, <code>.xls</code>, <code>.csv</code>)
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table className="guide-table">
              <thead>
                <tr>
                  <th>단어 (Word) <span style={{ color: '#dc2626' }}>*필수</span></th>
                  <th>뜻 (Meaning) <span style={{ color: '#dc2626' }}>*필수</span></th>
                  <th>품사 (POS)</th>
                  <th>발음기호 (Phonetic)</th>
                  <th>예문 (Example)</th>
                  <th>유닛/폴더 (Unit)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>early</strong></td>
                  <td>이른, 일찍</td>
                  <td>형용사</td>
                  <td>[ə́ːrli]</td>
                  <td>I wake up early in the morning.</td>
                  <td><span style={{ background: '#fef08a', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>01강</span></td>
                </tr>
                <tr>
                  <td><strong>curious</strong></td>
                  <td>호기심 많은</td>
                  <td>형용사</td>
                  <td>[kjúəriəs]</td>
                  <td>Children are naturally curious.</td>
                  <td><span style={{ background: '#fef08a', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>02강</span></td>
                </tr>
                <tr>
                  <td><strong>challenge</strong></td>
                  <td>도전, 도전하다</td>
                  <td>명사</td>
                  <td>[tʃǽlindʒ]</td>
                  <td>A great challenge.</td>
                  <td><span style={{ background: '#e0f2fe', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#0369a1' }}>영어책이름/1권/03강</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. 중복 단어 처리 옵션 안내 */}
        <div className="guide-section">
          <div className="guide-section-title">
            <CheckCircle2 size={15} color="#16a34a" />
            <span>이미 등록된 단어 처리 옵션</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            • <strong>건너뛰기 (기본/권장)</strong>: 이미 단어장에 존재하는 단어는 중복 추가하지 않고 안전하게 건너뜁니다.<br />
            • <strong>내용 업데이트</strong>: 뜻이나 예문, 폴더를 엑셀 내용으로 최신화합니다. (기존 FSRS 망각곡선 복습 진도는 그대로 보존됩니다!)<br />
            • <strong>중복 허용</strong>: 같은 단어가 이미 있어도 새로 단어를 추가합니다.
          </div>
        </div>

        {/* 4. 샘플 엑셀 다운로드 버튼 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="submit-btn"
            style={{ flex: 1, padding: '10px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            onClick={downloadSampleExcelFile}
          >
            <Download size={14} />
            표준 샘플 엑셀 양식 다운로드 (.xlsx)
          </button>
          <button
            type="button"
            className="guide-btn-confirm"
            style={{ width: 'auto', padding: '10px 20px' }}
            onClick={onClose}
          >
            확인 (닫기)
          </button>
        </div>
      </div>
    </div>
  );
};
