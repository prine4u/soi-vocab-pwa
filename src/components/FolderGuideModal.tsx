import React from 'react';
import {
  X,
  FolderTree,
  Pencil,
  Plus,
  ArrowUpDown,
  Sparkles,
} from 'lucide-react';

interface FolderGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FolderGuideModal: React.FC<FolderGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="guide-modal-backdrop" onClick={onClose}>
      <div className="guide-modal" onClick={(e) => e.stopPropagation()}>
        {/* 모달 헤더 */}
        <div className="guide-modal-header">
          <span className="guide-modal-title">
            <FolderTree size={20} color="#eab308" />
            문제집 폴더 3단계 관리 설명서
          </span>
          <button type="button" className="mini-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* 1. 3단계 폴더 계층 구조 개념 */}
        <div className="guide-section highlight">
          <div className="guide-section-title">
            <Sparkles size={16} color="#eab308" />
            <span>3단계 다단계 폴더 구조란? (시리즈 ➔ 권 ➔ 강)</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            단어장이 많아져도 원하는 단위로 묶어서 공부할 수 있도록 컴퓨터 폴더처럼{' '}
            <strong>슬래시(<code>/</code>)</strong>를 기준으로 계층을 자유롭게 나눌 수 있습니다.
          </p>
          <div className="guide-card-tree-preview">
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
              ★ 일빵빵 기초영어 <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(1단계: 시리즈 대분류)</span>
            </div>
            <div style={{ paddingLeft: 16, borderLeft: '1.5px dashed #cbd5e1', marginLeft: 6 }}>
              <div style={{ fontWeight: 700, color: '#0284c7', margin: '3px 0' }}>
                └ 📁 1권 <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(2단계: 권/책 중분류)</span>
              </div>
              <div style={{ paddingLeft: 16, borderLeft: '1.5px dashed #cbd5e1', marginLeft: 6, color: '#64748b' }}>
                <div>└ 📄 01강, 02강... <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(3단계: 강/단원 소분류)</span></div>
              </div>
              <div style={{ fontWeight: 700, color: '#0284c7', margin: '4px 0 3px' }}>
                └ 📁 2권
              </div>
              <div style={{ paddingLeft: 16, borderLeft: '1.5px dashed #cbd5e1', marginLeft: 6, color: '#64748b' }}>
                <div>└ 📄 31강, 32강, 33강...</div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. 초특급 꿀팁: 기존 폴더 3단계로 이동하기 */}
        <div className="guide-section">
          <div className="guide-section-title">
            <Pencil size={15} color="#0284c7" />
            <span>기존 등록된 폴더를 3단계로 한 번에 이동하기 (추천!)</span>
          </div>
          <div className="guide-step-grid">
            <div className="guide-step-item">
              <span className="guide-step-badge yellow">1단계</span>
              <div className="guide-step-body">
                폴더 목록에서 <code>★ 일빵빵 기초영어 2</code> 옆의 <strong>연필(✏️) 수정 아이콘</strong>을 누릅니다.
              </div>
            </div>
            <div className="guide-step-item">
              <span className="guide-step-badge yellow">2단계</span>
              <div className="guide-step-body">
                이름을 <strong><code>일빵빵 기초영어/2권</code></strong>으로 슬래시를 넣어 수정하고 확인을 누릅니다.
              </div>
            </div>
            <div className="guide-step-item">
              <span className="guide-step-badge yellow">완료!</span>
              <div className="guide-step-body">
                기존 700개 단어(31강~47강 등)가 자동으로 <strong>[일빵빵 기초영어]</strong> 아래의 <strong>[2권]</strong> 폴더로 한 번에 쏙 이동하여 3단계 계층 트리가 즉시 완성됩니다!
              </div>
            </div>
          </div>
        </div>

        {/* 3. 새 폴더 만들기 및 하위 추가 */}
        <div className="guide-section">
          <div className="guide-section-title">
            <Plus size={15} color="#16a34a" />
            <span>새 3단계 폴더 만들기 & 하위 유닛 추가</span>
          </div>
          <div className="guide-step-grid">
            <div className="guide-step-item">
              <span className="guide-step-badge">새 폴더</span>
              <div className="guide-step-body">
                상단 첫 번째 칸에 <code>일빵빵 기초영어/1권</code>, 두 번째 칸에 <code>01강</code>을 적고 <strong>[+ 생성]</strong>을 누르면 3단계 폴더가 즉시 만들어집니다.
              </div>
            </div>
            <div className="guide-step-item">
              <span className="guide-step-badge">+ 버튼</span>
              <div className="guide-step-body">
                목록에서 <code>2권</code> 옆의 <strong>`+` 버튼</strong>을 누르면 그 바로 아래에 들어갈 <code>35강</code>을 원클릭으로 추가할 수 있습니다.
              </div>
            </div>
          </div>
        </div>

        {/* 4. 폴더 접기/펼치기 및 순서 이동 */}
        <div className="guide-section">
          <div className="guide-section-title">
            <ArrowUpDown size={15} color="#8b5cf6" />
            <span>폴더 접기/펼치기 및 정렬 기능</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem', color: '#475569' }}>
            <div>
              • <strong>폴더 접기 (화살표 &gt; / v)</strong>: 보지 않는 시리즈나 권은 화살표를 눌러 쏙 접어두고, 공부하고 싶은 강만 깔끔하게 펼쳐볼 수 있습니다.
            </div>
            <div>
              • <strong>모두 접기 / 모두 펼치기</strong>: 상단 버튼을 눌러 모든 폴더를 한 번에 접거나 펼쳐서 한눈에 정리할 수 있습니다.
            </div>
            <div>
              • <strong>위/아래 이동 (▲ / ▼)</strong>: 같은 레벨 내에서 책이나 단원의 순서를 원하는 대로 위아래로 재배치할 수 있습니다.
            </div>
          </div>
        </div>

        {/* 모달 닫기 버튼 */}
        <button type="button" className="guide-btn-confirm" onClick={onClose}>
          확인했습니다 (닫기)
        </button>
      </div>
    </div>
  );
};
