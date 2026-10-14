import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { AlarmMarker, FloorPlan, IconKind, TagOption } from '../../../shared/contracts';

interface MarkerInspectorProps {
  hasPages: boolean;
  currentPage: FloorPlan | null;
  marker: AlarmMarker | null;
  tags: TagOption[];
  tagsLoaded: boolean;
  tagError: string;
  onAddMarker: (name: string) => void;
  onChange: (patch: Partial<AlarmMarker>) => void;
  onRemove: () => void;
  onUploadIcon: (file: File) => Promise<void>;
  onLoadTags: () => void;
}

const iconOptions: Array<{ value: IconKind; label: string }> = [
  { value: 'sos', label: 'SOS 圓牌' },
  { value: 'warning', label: '警告三角' },
  { value: 'circle', label: '色彩圓點' },
  { value: 'push-button', label: '緊急押鈕' },
  { value: 'custom', label: '自訂圖示' },
];

export function MarkerInspector({ hasPages, currentPage, marker, tags, tagsLoaded, tagError, onAddMarker, onChange, onRemove, onUploadIcon, onLoadTags }: MarkerInspectorProps): JSX.Element {
  const [searchText, setSearchText] = useState('');
  const [manualName, setManualName] = useState('');
  const [iconError, setIconError] = useState('');

  const markerDescription: string = tags.find((tag: TagOption) => tag.name === marker?.name)?.description.trim() ?? '';

  const filteredTags: TagOption[] = tags.filter((tag: TagOption) => `${tag.name} ${tag.description}`.toLocaleLowerCase().includes(searchText.toLocaleLowerCase())).slice(0, 30);

  function handleIconFile(event: ChangeEvent<HTMLInputElement>): void {
    const file: File | undefined = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file === undefined) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setIconError('圖示只支援 PNG 或 JPEG。');
      return;
    }
    setIconError('');
    void onUploadIcon(file);
  }

  function addName(name: string): void {
    if (currentPage === null || marker !== null) return;
    onAddMarker(name);
    setManualName('');
  }

  return (
    <aside className="inspector-panel">
      {currentPage === null ? (
        <div className="inspector-heading">
          <span className="section-kicker">測點設定</span>
          <h2>{hasPages ? '尚未選取頁面' : '建立測點頁面'}</h2>
          <p>{hasPages ? '請從左側選取測點頁面，再為它指定唯一的 WebAccess Name。' : '先新增測點頁面，再為它指定唯一的 WebAccess Name。'}</p>
        </div>
      ) : marker === null ? (
        <>
          <div className="inspector-heading">
            <span className="section-kicker">{currentPage.name || '未命名測點頁面'}</span>
            <h2>綁定測點 Name</h2>
            <p>此頁面尚未綁定測點。每個測點使用獨立圖面。</p>
          </div>
          <label className="field-label" htmlFor="tag-search">搜尋 WebAccess 測點</label>
          <div className="search-field"><span aria-hidden="true">⌕</span><input id="tag-search" value={searchText} onChange={(event) => setSearchText(event.currentTarget.value)} placeholder="輸入測點名稱或描述" /></div>
          {!tagsLoaded && <button className="text-button" type="button" onClick={onLoadTags}>載入 WebAccess 測點清單</button>}
          {tagError.length > 0 && <p className="inline-error">{tagError}，可改用下方手動輸入。</p>}
          {tagsLoaded && (
            <div className="tag-results" aria-label="測點搜尋結果">
              {filteredTags.length === 0 ? <p className="quiet-message">沒有符合的測點</p> : filteredTags.map((tag: TagOption) => (
                <button className="tag-result" type="button" key={tag.name} onClick={() => addName(tag.name)}>
                  <span className="tag-result-icon">⌁</span><span className="tag-result-copy"><span className="tag-result-name">{tag.name}</span><span className="tag-result-description">{tag.description}</span></span><span className="tag-result-add">＋</span>
                </button>
              ))}
            </div>
          )}
          <div className="field-divider"><span>或手動輸入</span></div>
          <label className="field-label" htmlFor="manual-tag-name">測點 Name</label>
          <div className="manual-add-row">
            <input id="manual-tag-name" value={manualName} onChange={(event) => setManualName(event.currentTarget.value)} placeholder="例如 1008-16_DI8" />
            <button className="icon-button add-button" type="button" disabled={manualName.trim().length === 0} onClick={() => addName(manualName.trim())} aria-label="綁定測點 Name">＋</button>
          </div>
          <div className="measurement-page-card"><span className="tag-result-icon">▧</span><span><small>獨立平面圖</small><strong>{currentPage.name || '未命名測點頁面'}</strong></span></div>
          <div className="inspector-tip"><span aria-hidden="true">✦</span><p>每個測點頁面只配置一個 Name、一張底圖與一個警報圖示。</p></div>
        </>
      ) : (
        <>
          <div className="inspector-heading inspector-heading-row">
            <div><span className="section-kicker">{currentPage.name || '未命名測點頁面'}</span><h2>測點設定</h2></div>
            <button className="danger-quiet-button" type="button" onClick={onRemove}>解除測點</button>
          </div>
          <label className="field-label" htmlFor="marker-name">測點 Name</label>
          <input id="marker-name" value={marker.name} onChange={(event) => onChange({ name: event.currentTarget.value })} />
          <div className="marker-description"><span className="field-label">WebAccess 測點描述</span><p>{markerDescription || (tagError ? '無法取得描述，請重新讀取測點清單。' : tagsLoaded ? '此測點未提供描述，或不在回傳清單內。' : '正在讀取測點描述…')}</p></div>
          <div className="measurement-page-card"><span className="tag-result-icon">▧</span><span><small>此測點的獨立平面圖</small><strong>{currentPage.name || '未命名測點頁面'}</strong></span></div>
          <label className="field-label" htmlFor="marker-text">警報文字 <span className="optional-label">（顯示於圖面上方）</span></label>
          <textarea id="marker-text" rows={3} value={marker.text} onChange={(event) => onChange({ text: event.currentTarget.value })} placeholder="留白時使用警報描述，再退回測點 Name" />
          <p className="field-hint">文字不會覆蓋在平面圖或圖示上。</p>
          <label className="toggle-row"><span><strong>避難訊息旁顯示 EXIT 圖示</strong><small>保留平面圖，隱藏圖面警報圖示；取消後恢復</small></span><input type="checkbox" checked={marker.shouldShowExitIcon === true} onChange={(event) => onChange({ shouldShowExitIcon: event.currentTarget.checked })} /><span className="toggle-control" /></label>
          <div className="field-row coordinates-row">
            <div><label className="field-label" htmlFor="marker-x">水平位置</label><div className="input-suffix"><input id="marker-x" type="number" min="0" max="100" step="0.1" value={marker.x} onChange={(event) => onChange({ x: clampNumber(event.currentTarget.value, 0, 100) })} /><span>%</span></div></div>
            <div><label className="field-label" htmlFor="marker-y">垂直位置</label><div className="input-suffix"><input id="marker-y" type="number" min="0" max="100" step="0.1" value={marker.y} onChange={(event) => onChange({ y: clampNumber(event.currentTarget.value, 0, 100) })} /><span>%</span></div></div>
          </div>
          <label className="field-label">圖示樣式</label>
          <div className="icon-choice-grid">
            {iconOptions.map((option: { value: IconKind; label: string }) => (
              <button key={option.value} type="button" className={`icon-choice${marker.iconKind === option.value ? ' is-active' : ''}`} onClick={() => onChange({ iconKind: option.value })}>
                {option.value === 'push-button' ? <img className="choice-symbol" src="/icons/emergency-push-button.svg" alt="" /> : <span className={`choice-symbol choice-${option.value}`}>{option.value === 'sos' ? 'SOS' : option.value === 'warning' ? '▲' : option.value === 'circle' ? '●' : '▧'}</span>}<span>{option.label}</span>
              </button>
            ))}
          </div>
          {marker.iconKind === 'custom' && <label className="upload-inline"><span>上傳 PNG / JPEG 圖示</span><input type="file" accept="image/png,image/jpeg" onChange={handleIconFile} /></label>}
          {iconError.length > 0 && <p className="inline-error">{iconError}</p>}
          <div className="field-row style-row">
            {marker.iconKind !== 'custom' && marker.iconKind !== 'push-button' && <div><label className="field-label" htmlFor="marker-color">圖示顏色</label><div className="color-input"><input id="marker-color" type="color" value={marker.color} onChange={(event) => onChange({ color: event.currentTarget.value })} /><span>{marker.color.toUpperCase()}</span></div></div>}
            <div><label className="field-label" htmlFor="marker-size">大小</label><div className="input-suffix"><input id="marker-size" type="number" min="20" max="160" value={marker.size} onChange={(event) => onChange({ size: clampNumber(event.currentTarget.value, 20, 160) })} /><span>px</span></div></div>
          </div>
          <label className="toggle-row"><span><strong>警報時閃爍</strong><small>模擬預覽與正式顯示皆套用</small></span><input type="checkbox" checked={marker.shouldBlink} onChange={(event) => onChange({ shouldBlink: event.currentTarget.checked })} /><span className="toggle-control" /></label>
        </>
      )}
    </aside>
  );
}

function clampNumber(value: string, min: number, max: number): number {
  const parsedValue: number = Number(value);
  if (!Number.isFinite(parsedValue)) return min;
  return Math.max(min, Math.min(max, parsedValue));
}
