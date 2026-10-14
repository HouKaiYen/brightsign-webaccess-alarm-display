import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { AlarmMarker, AlarmSettings, FloorPlan, TagOption } from '../../shared/contracts';
import { EmptySettings } from '../../shared/contracts';
import { MarkerInspector } from './components/MarkerInspector';
import { PlanCanvas } from './components/PlanCanvas';
import { FloorPlanLibrary } from './components/FloorPlanLibrary';
import { ConnectionSettings } from './components/ConnectionSettings';
import { SystemControls } from './components/SystemControls';
import { getSettings, getTags, putSettings, SettingsApiError, uploadImage } from './services/settingsApi';

function copySettings(settings: AlarmSettings): AlarmSettings {
  return {
    version: settings.version,
    pages: settings.pages.map((page: FloorPlan) => ({ ...page })),
    markers: settings.markers.map((marker: AlarmMarker) => ({ ...marker })),
    idleImageUrl: settings.idleImageUrl,
    idle: settings.idle === undefined ? undefined : structuredClone(settings.idle),
    floorPlanImages: (settings.floorPlanImages ?? settings.pages.filter((page: FloorPlan, index: number, pages: FloorPlan[]) => page.imageUrl !== '' && pages.findIndex((item: FloorPlan) => item.imageUrl === page.imageUrl) === index)).map((image: FloorPlan) => ({ ...image })),
  };
}

function createId(): string {
  const randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16));
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;
  const hex: string[] = Array.from(randomBytes, (value: number) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function SettingsApp(): JSX.Element {
  const [savedSettings, setSavedSettings] = useState<AlarmSettings | null>(null);
  const [draft, setDraft] = useState<AlarmSettings>(copySettings(EmptySettings));
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pagePendingDeletion, setPagePendingDeletion] = useState<FloorPlan | null>(null);
  const [imagePendingRemoval, setImagePendingRemoval] = useState<FloorPlan | null>(null);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [hasTagsLoaded, setHasTagsLoaded] = useState<boolean>(false);
  const [tagError, setTagError] = useState<string>('');
  const [loadError, setLoadError] = useState<string>('');
  const [saveError, setSaveError] = useState<string>('');
  const [saveConflict, setSaveConflict] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isPreviewEnabled, setIsPreviewEnabled] = useState<boolean>(false);
  const [pageImageError, setPageImageError] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');
  const [libraryStatus, setLibraryStatus] = useState<string>('');

  const isDirty: boolean = savedSettings === null || JSON.stringify(draft) !== JSON.stringify(savedSettings);
  const selectedPage: FloorPlan | null = draft.pages.find((page: FloorPlan) => page.id === selectedPageId) ?? null;
  const pageMarkers: AlarmMarker[] = useMemo(() => selectedPage === null ? [] : draft.markers.filter((marker: AlarmMarker) => marker.pageId === selectedPage.id), [draft.markers, selectedPage]);
  const selectedMarker: AlarmMarker | null = pageMarkers[0] ?? null;

  useEffect(() => {
    void loadSavedSettings();
    void loadTagOptions();
  }, []);

  useEffect(() => {
    function preventUnsavedChanges(event: BeforeUnloadEvent): void {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', preventUnsavedChanges);
    return () => window.removeEventListener('beforeunload', preventUnsavedChanges);
  }, [isDirty]);

  async function loadSavedSettings(): Promise<void> {
    setIsLoading(true);
    setLoadError('');
    try {
      const settings: AlarmSettings = await getSettings();
      const safeSettings: AlarmSettings = copySettings(settings);
      setSavedSettings(copySettings(safeSettings));
      setDraft(safeSettings);
      setSelectedPageId(null);
      setSaveError('');
      setSaveConflict(false);
    } catch (error: unknown) {
      setLoadError(errorMessage(error, '無法載入已儲存設定。請確認服務已啟動後重新整理。'));
    } finally {
      setIsLoading(false);
    }
  }

  function updateDraft(change: (current: AlarmSettings) => AlarmSettings): void {
    setDraft((current: AlarmSettings) => change(current));
    if (!saveConflict) setSaveError('');
  }

  function addPage(): void {
    let pageNumber: number = draft.pages.length + 1;
    while (draft.pages.some((page: FloorPlan) => page.name === `測點頁面 ${pageNumber}`)) pageNumber++;
    const page: FloorPlan = { id: createId(), name: `測點頁面 ${pageNumber}`, imageUrl: '' };
    updateDraft((current: AlarmSettings) => ({ ...current, pages: [...current.pages, page] }));
    setSelectedPageId(page.id);
    setIsPreviewEnabled(false);
    setPageImageError('');
  }

  function renamePage(pageId: string, name: string): void {
    updateDraft((current: AlarmSettings) => ({
      ...current,
      pages: current.pages.map((page: FloorPlan) => page.id === pageId ? { ...page, name } : page),
    }));
  }

  async function uploadFloorPlans(files: File[]): Promise<void> {
    if (isUploading) return;
    setIsUploading(true);
    const failedNames: string[] = [];
    let successfulCount: number = 0;
    try {
      for (const [index, file] of files.entries()) {
        setLibraryStatus(`正在上傳 ${index + 1} / ${files.length}：${file.name}`);
        try {
          if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('只支援 PNG 或 JPEG');
          const result: Awaited<ReturnType<typeof uploadImage>> = await uploadImage(file);
          const image: FloorPlan = { id: createId(), name: file.name.replace(/\.[^.]+$/, '') || file.name, imageUrl: result.imageUrl };
          updateDraft((current: AlarmSettings) => ({ ...current, floorPlanImages: [...(current.floorPlanImages ?? []), image] }));
          successfulCount++;
        } catch (error: unknown) {
          failedNames.push(`${file.name}（${errorMessage(error, '上傳失敗')}）`);
        }
      }
      setLibraryStatus(`已上傳 ${successfulCount} / ${files.length} 張。${failedNames.length > 0 ? `失敗：${failedNames.join('、')}` : '請儲存設定，各測點頁面即可選用。'}`);
    } finally {
      setIsUploading(false);
    }
  }

  function requestImageRemoval(image: FloorPlan): void {
    const usingPages: FloorPlan[] = draft.pages.filter((page: FloorPlan) => page.imageUrl === image.imageUrl);
    if (usingPages.length > 0 || draft.idleImageUrl === image.imageUrl || draft.markers.some((marker: AlarmMarker) => marker.iconUrl === image.imageUrl && marker.iconKind === 'custom')) {
      setLibraryStatus(`「${image.name}」仍被使用，請先更換圖片後再移除。${usingPages.length > 0 ? `使用頁面：${usingPages.map((page: FloorPlan) => page.name).join('、')}` : '待機畫面或自訂警報圖示正在使用此圖。'}`);
      return;
    }
    setImagePendingRemoval(image);
  }

  function confirmImageRemoval(): void {
    if (imagePendingRemoval === null) return;
    const image: FloorPlan = imagePendingRemoval;
    updateDraft((current: AlarmSettings) => ({ ...current, floorPlanImages: (current.floorPlanImages ?? []).filter((item: FloorPlan) => item.id !== image.id) }));
    setLibraryStatus(`已從圖庫移除「${image.name}」，請儲存設定。`);
    setImagePendingRemoval(null);
  }

  function movePage(pageId: string, offset: number): void {
    updateDraft((current: AlarmSettings) => {
      const index: number = current.pages.findIndex((page: FloorPlan) => page.id === pageId);
      const targetIndex: number = index + offset;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.pages.length) return current;
      const pages: FloorPlan[] = [...current.pages];
      const [page]: FloorPlan[] = pages.splice(index, 1);
      pages.splice(targetIndex, 0, page);
      return { ...current, pages };
    });
  }

  function deletePage(page: FloorPlan): void {
    setPagePendingDeletion(page);
  }

  function confirmDeletePage(): void {
    const page: FloorPlan | null = pagePendingDeletion;
    if (page === null) return;
    const pages: FloorPlan[] = draft.pages.filter((item: FloorPlan) => item.id !== page.id);
    updateDraft((current: AlarmSettings) => ({
      ...current,
      pages,
      markers: current.markers.filter((marker: AlarmMarker) => marker.pageId !== page.id),
    }));
    setSelectedPageId(null);
    setIsPreviewEnabled(false);
    setPagePendingDeletion(null);
  }

  async function handlePageImage(file: File | undefined): Promise<void> {
    if (isUploading) return;
    setPageImageError('');
    if (file === undefined || selectedPage === null) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setPageImageError('平面圖只支援 PNG 或 JPEG。');
      return;
    }
    setIsUploading(true);
    try {
      const result = await uploadImage(file);
      const pageId: string = selectedPage.id;
      const image: FloorPlan = { id: createId(), name: file.name.replace(/\.[^.]+$/, '') || file.name, imageUrl: result.imageUrl };
      updateDraft((current: AlarmSettings) => ({ ...current, floorPlanImages: [...(current.floorPlanImages ?? []), image], pages: current.pages.map((page: FloorPlan) => page.id === pageId ? { ...page, imageUrl: result.imageUrl } : page) }));
    } catch (error: unknown) {
      setPageImageError(errorMessage(error, '圖片上傳失敗。'));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleIconUpload(file: File): Promise<void> {
    if (isUploading) return;
    const markerId: string | null = selectedMarker?.id ?? null;
    if (markerId === null) return;
    setUploadError('');
    setIsUploading(true);
    try {
      const result = await uploadImage(file);
      updateDraft((current: AlarmSettings) => ({ ...current, markers: current.markers.map((marker: AlarmMarker) => marker.id === markerId ? { ...marker, iconKind: 'custom', iconUrl: result.imageUrl } : marker) }));
    } catch (error: unknown) {
      setUploadError(errorMessage(error, '警報圖示上傳失敗。'));
    } finally {
      setIsUploading(false);
    }
  }

  function addMarker(name: string): void {
    if (selectedPage === null || pageMarkers.length > 0) return;
    if (draft.markers.some((marker: AlarmMarker) => marker.name === name)) {
      setTagError(`測點「${name}」已存在，Name 必須唯一。`);
      return;
    }
    const marker: AlarmMarker = {
      id: createId(), name, pageId: selectedPage.id, text: '', x: 50, y: 50, size: 48, color: '#ef1c27',
      shouldBlink: true, iconKind: 'sos', iconUrl: '',
    };
    updateDraft((current: AlarmSettings) => ({ ...current, markers: [...current.markers, marker] }));
    setTagError('');
  }

  function changeMarker(markerId: string, patch: Partial<AlarmMarker>): void {
    if (patch.name !== undefined && draft.markers.some((marker: AlarmMarker) => marker.id !== markerId && marker.name === patch.name)) {
      setSaveError(`測點 Name「${patch.name}」已被使用，請改用唯一名稱。`);
      return;
    }
    updateDraft((current: AlarmSettings) => ({
      ...current,
      markers: current.markers.map((marker: AlarmMarker) => marker.id === markerId ? { ...marker, ...patch } : marker),
    }));
  }

  function removeMarker(): void {
    if (selectedMarker === null) return;
    updateDraft((current: AlarmSettings) => ({ ...current, markers: current.markers.filter((marker: AlarmMarker) => marker.id !== selectedMarker.id) }));
    setIsPreviewEnabled(false);
  }

  async function loadTagOptions(): Promise<void> {
    setTagError('');
    try {
      const availableTags: TagOption[] = await getTags();
      setTags(availableTags);
      setHasTagsLoaded(true);
    } catch (error: unknown) {
      setTags([]);
      setTagError(errorMessage(error, '無法取得 WebAccess 測點清單'));
      setHasTagsLoaded(false);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!isDirty || isSaving || isUploading || saveConflict || savedSettings === null) return;
    const duplicateName: string | undefined = findDuplicateName(draft.markers);
    if (duplicateName !== undefined) {
      setSaveError(`測點 Name「${duplicateName}」重複，請先修正。`);
      return;
    }
    if (draft.markers.some((marker: AlarmMarker) => !draft.pages.some((page: FloorPlan) => page.id === marker.pageId))) {
      setSaveError('有測點未指定有效的平面圖，請檢查後再儲存。');
      return;
    }
    if (draft.pages.some((page: FloorPlan) => draft.markers.filter((marker: AlarmMarker) => marker.pageId === page.id).length > 1)) {
      setSaveError('每個測點頁面只能綁定一個 Name。請解除同頁多餘的測點後再儲存。');
      return;
    }
    if (draft.markers.some((marker: AlarmMarker) => marker.iconKind === 'custom' && marker.iconUrl.length === 0)) {
      setSaveError('有自訂圖示尚未上傳圖片，請完成上傳或改選內建圖示。');
      return;
    }
    setIsSaving(true);
    setSaveError('');
    try {
      const submittedSettings: AlarmSettings = { ...copySettings(draft), version: savedSettings.version };
      const persistedSettings: AlarmSettings = await putSettings(submittedSettings);
      const safeSettings: AlarmSettings = copySettings(persistedSettings);
      setDraft((current: AlarmSettings) => ({ ...current, version: safeSettings.version }));
      setSavedSettings(copySettings(safeSettings));
      setSaveError('');
    } catch (error: unknown) {
      const isVersionConflict: boolean = error instanceof SettingsApiError && error.status === 409;
      setSaveConflict(isVersionConflict);
      setSaveError(isVersionConflict
        ? '伺服器上的設定已被其他人更新。為避免覆蓋，已停用儲存；重新載入伺服器設定後再編輯。'
        : errorMessage(error, '儲存失敗，請確認連線後再試。'));
    } finally {
      setIsSaving(false);
    }
  }

  function togglePreview(): void {
    setIsPreviewEnabled((current: boolean) => !current);
  }

  async function handlePlanUploadChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file: File | undefined = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    await handlePageImage(file);
  }

  if (isLoading) {
    return <main className="app-loading"><span className="loading-spinner" /><p>正在載入設定…</p></main>;
  }

  if (loadError.length > 0 && savedSettings === null) {
    return <main className="fatal-state"><div className="fatal-icon">!</div><p className="section-kicker">無法開啟設定</p><h1>設定服務尚未就緒</h1><p>{loadError}</p><button className="primary-button" type="button" onClick={() => void loadSavedSettings()}>重新載入</button></main>;
  }

  return (
    <div className="settings-app">
      <header className="topbar">
        <a className="brand" href="/settings" aria-label="返回日常管理"><span className="brand-mark"><span /></span><span className="brand-name">BrightSigh <small>ALARM MAP</small></span></a>
        <div className="topbar-center"><span className="crumb-muted">警報管理</span><span className="crumb-divider">/</span><strong>工程設定 · 測點頁面</strong></div>
        <div className="topbar-actions">
          <span className={`draft-status${isDirty ? ' is-unsaved' : ''}`}><span className="status-dot" />{isDirty ? '尚有未儲存變更' : '已同步'}</span>
          <a className="secondary-button" href="/settings">返回日常管理</a>
          <ConnectionSettings />
          <SystemControls />
          <button className="primary-button save-button" type="button" disabled={!isDirty || isSaving || isUploading || saveConflict || savedSettings === null} onClick={() => void saveDraft()}>{isSaving ? <><span className="button-spinner" />儲存中</> : '儲存設定'}</button>
        </div>
      </header>

      <div className="workspace">
        <nav className="sidebar" aria-label="測點頁面管理">
        <div className="sidebar-topline"><div><span className="section-kicker">設定工作區</span><h1>測點頁面</h1></div><button className="icon-button new-plan-button" type="button" onClick={addPage} title="新增測點頁面" aria-label="新增測點頁面">＋</button></div>
          <div className="plan-list">
            {draft.pages.length === 0 ? <div className="sidebar-empty"><span>▧</span><p>尚未建立測點頁面</p><button className="text-button" type="button" onClick={addPage}>＋ 新增測點頁面</button></div> : draft.pages.map((page: FloorPlan, index: number) => {
              const pageMarkersForRow: AlarmMarker[] = draft.markers.filter((marker: AlarmMarker) => marker.pageId === page.id);
              const pageTagDescription: string = tags.find((tag: TagOption) => tag.name === pageMarkersForRow[0]?.name)?.description.trim() ?? '';
              const pageTagLabel: string = pageMarkersForRow.length === 0 ? '尚未綁定 Name' : pageMarkersForRow.length === 1 ? pageMarkersForRow[0].name : `${pageMarkersForRow.length} 個測點需整理`;
              return (
              <div key={page.id} className={`plan-list-row${selectedPage?.id === page.id ? ' is-active' : ''}`}>
                <button className="plan-list-select" type="button" onClick={() => { setSelectedPageId(page.id); setIsPreviewEnabled(false); }}>
                  <span className="plan-thumb">{page.imageUrl ? <img src={page.imageUrl} alt="" /> : <span>▧</span>}</span>
                  <span className="plan-list-copy"><strong>{pageTagLabel}</strong>{pageTagDescription && <span className="plan-tag-description" title={pageTagDescription}>{pageTagDescription}</span>}<small>{page.name || '未命名測點頁面'}</small></span>
                </button>
                {selectedPage?.id === page.id && <div className="plan-order-controls"><button type="button" onClick={() => movePage(page.id, -1)} disabled={index === 0} aria-label="上移平面圖">↑</button><button type="button" onClick={() => movePage(page.id, 1)} disabled={index === draft.pages.length - 1} aria-label="下移平面圖">↓</button></div>}
              </div>
              );
            })}
          </div>
          <p className="sidebar-page-hint">每個測點使用獨立圖面</p>
          <button className="text-button" type="button" onClick={() => void loadTagOptions()}>重新讀取測點描述</button>
          {tagError && <p className="inline-error">{tagError}</p>}
          <FloorPlanLibrary images={draft.floorPlanImages ?? []} isUploading={isUploading} status={libraryStatus} onUpload={uploadFloorPlans} onRemove={requestImageRemoval} />
          <div className="sidebar-footer">
            <div className="sidebar-section-title">待機播放</div>
            <p className="sidebar-helper">輪播內容與跑馬燈請到日常管理頁設定。</p>
            <a className="secondary-button upload-idle-button" href="/settings">前往日常管理</a>
          </div>
        </nav>

        <main className="editor-main">
          {uploadError && <div className="notice-bar error-notice" role="alert">{uploadError}</div>}
          {loadError && <div className="notice-bar error-notice">{loadError}<button type="button" onClick={() => void loadSavedSettings()}>重試</button></div>}
          {saveError && <div className={`notice-bar error-notice${saveConflict ? ' conflict-notice' : ''}`} role="alert"><span>{saveError}</span>{saveConflict && <button type="button" onClick={() => void loadSavedSettings()}>重新載入</button>}</div>}
          <div className="editor-toolbar">
            <div className="page-title-group">
              <span className="section-kicker">測點頁面編輯器</span>
              {selectedPage ? <input className="page-title-input" aria-label="測點頁面名稱" value={selectedPage.name} onChange={(event) => renamePage(selectedPage.id, event.currentTarget.value)} /> : <h2>{draft.pages.length > 0 ? '請從左側選取測點頁面' : '建立你的第一個測點頁面'}</h2>}
            </div>
            <div className="toolbar-actions">
              {selectedPage && <button className={`preview-button${isPreviewEnabled ? ' is-active' : ''}`} type="button" disabled={selectedMarker === null} onClick={togglePreview} title={selectedMarker === null ? '先為此頁面綁定測點 Name' : ''}><span>◉</span>{isPreviewEnabled ? '關閉模擬' : '模擬警報'}</button>}
              {selectedPage && <button className="secondary-button delete-page-button" type="button" onClick={() => deletePage(selectedPage)}>刪除測點頁面</button>}
            </div>
          </div>
          {selectedPage && (
            <div className="canvas-toolbar">
              <div className="canvas-breadcrumb"><span className="mini-plan-icon">▧</span><strong>{selectedMarker?.name ?? '尚未綁定 Name'}</strong><span className="canvas-slash">/</span><span>{selectedPage.name || '未命名測點頁面'}</span></div>
              <label className="library-selector">共用平面圖
                <select aria-label="選用共用平面圖" value={(draft.floorPlanImages ?? []).some((image: FloorPlan) => image.imageUrl === selectedPage.imageUrl) ? selectedPage.imageUrl : ''} disabled={isUploading} onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const imageUrl: string = event.currentTarget.value;
                  if (imageUrl !== '') updateDraft((current: AlarmSettings) => ({ ...current, pages: current.pages.map((page: FloorPlan) => page.id === selectedPage.id ? { ...page, imageUrl } : page) }));
                }}>
                  <option value="">請選擇樓層圖</option>
                  {(draft.floorPlanImages ?? []).map((image: FloorPlan) => <option key={image.id} value={image.imageUrl}>{image.name}</option>)}
                </select>
              </label>
              <label className="secondary-button image-upload-button">{isUploading ? '圖片上傳中…' : selectedPage.imageUrl ? '更換平面圖' : '＋ 上傳平面圖'}<input type="file" accept="image/png,image/jpeg" onChange={(event) => void handlePlanUploadChange(event)} disabled={isUploading} /></label>
            </div>
          )}
          {pageImageError && <div className="notice-bar error-notice">{pageImageError}</div>}
          {pageMarkers.length > 1 && <div className="notice-bar error-notice" role="alert">此測點頁面目前綁定多個 Name。每個頁面只能有一個測點，請在右側逐一解除多餘的 Name。</div>}
          {isPreviewEnabled && selectedMarker !== null && (
            <section className="preview-alarm-text" aria-label="模擬警報文字" aria-live="polite">
              <div className="preview-alarm-heading"><span className="preview-alarm-indicator" /><strong>模擬警報</strong><span>平面圖上方顯示警報文字</span></div>
              <div className="preview-alarm-list">
                {selectedMarker && <div className="preview-alarm-item"><span className="preview-alarm-point" /><span>{getPreviewAlarmText(selectedMarker, tags)}</span>{selectedMarker.shouldShowExitIcon && <img className="preview-exit-icon" src="/icons/evacuation-exit.svg" alt="EXIT 避難出口" />}</div>}
              </div>
            </section>
          )}
          <section className={`canvas-card${isPreviewEnabled && selectedMarker !== null ? ' has-alarm' : ''}`} aria-label="平面圖畫布">
            <PlanCanvas page={selectedPage} marker={selectedMarker} previewEnabled={isPreviewEnabled} onMoveMarker={(markerId: string, x: number, y: number) => changeMarker(markerId, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })} />
          </section>
          {selectedPage && <div className="canvas-caption"><span>拖曳圖示調整位置</span><span className="caption-separator">·</span><span>座標依原圖比例保存</span><span className="caption-spacer" /><span>{selectedPage.imageUrl ? '圖片比例自動適應' : '支援 PNG、JPEG'}</span></div>}
        </main>

        <MarkerInspector
          hasPages={draft.pages.length > 0}
          currentPage={selectedPage}
          marker={selectedMarker}
          tags={tags}
          tagsLoaded={hasTagsLoaded}
          tagError={tagError}
          onAddMarker={addMarker}
          onChange={(patch: Partial<AlarmMarker>) => selectedMarker && changeMarker(selectedMarker.id, patch)}
          onRemove={removeMarker}
          onUploadIcon={handleIconUpload}
          onLoadTags={() => void loadTagOptions()}
        />
      </div>
      {isUploading && <div className="uploading-toast"><span className="button-spinner" />圖片處理中…</div>}
      {imagePendingRemoval && <div className="dialog-backdrop">
        <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-image-title">
          <h2 id="remove-image-title">移除平面圖</h2>
          <p>確定從圖庫移除「{imagePendingRemoval.name}」嗎？按下儲存設定後才會套用。</p>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setImagePendingRemoval(null)} autoFocus>取消</button>
            <button className="primary-button" type="button" onClick={confirmImageRemoval}>確定移除</button>
          </div>
        </section>
      </div>}
      {pagePendingDeletion && <div className="dialog-backdrop">
        <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-plan-title">
          <h2 id="delete-plan-title">刪除測點頁面</h2>
          <p>確定刪除「{pagePendingDeletion.name}」及其綁定的測點 Name 嗎？按下儲存設定後才會套用。</p>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setPagePendingDeletion(null)} autoFocus>取消</button>
            <button className="primary-button" type="button" onClick={confirmDeletePage}>確定刪除</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

function findDuplicateName(markers: AlarmMarker[]): string | undefined {
  const seenNames: Set<string> = new Set<string>();
  for (const marker of markers) {
    if (seenNames.has(marker.name)) return marker.name;
    seenNames.add(marker.name);
  }
  return undefined;
}

function getPreviewAlarmText(marker: AlarmMarker, tags: TagOption[]): string {
  const customText: string = marker.text.trim();
  if (customText.length > 0) return customText;
  const description: string = tags.find((tag: TagOption) => tag.name === marker.name)?.description.trim() ?? '';
  return description.length > 0 ? description : marker.name;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default SettingsApp;
