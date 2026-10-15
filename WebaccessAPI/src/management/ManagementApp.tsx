import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import { DefaultIdleSettings } from '../../shared/contracts';
import type { IdleMedia, IdleMediaKind, IdleSettings, VersionedIdleSettings } from '../../shared/contracts';

import { MarqueePreview } from './MarqueePreview';

const sizeLimits: Record<IdleMediaKind, number> = { image: 20, gif: 20, video: 100, pdf: 30 };

function ManagementApp(): JSX.Element {
  const [saved, setSaved] = useState<VersionedIdleSettings | null>(null);
  const [draft, setDraft] = useState<IdleSettings>(DefaultIdleSettings);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [conflict, setConflict] = useState<boolean>(false);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [previewPage, setPreviewPage] = useState<number>(0);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [isLibraryLoading, setIsLibraryLoading] = useState<boolean>(false);
  const [libraryItems, setLibraryItems] = useState<IdleMedia[]>([]);
  const [selectedLibraryUrls, setSelectedLibraryUrls] = useState<string[]>([]);
  const [librarySearch, setLibrarySearch] = useState<string>('');
  const [libraryError, setLibraryError] = useState<string>('');
  const isDirty: boolean = useMemo(() => saved === null || JSON.stringify(draft) !== JSON.stringify({ items: saved.items, isMuted: saved.isMuted, marquee: saved.marquee }), [draft, saved]);

  async function loadSettings(): Promise<void> {
    setIsLoading(true); setError(''); setConflict(false);
    try {
      const response: Response = await fetch('/api/idle-settings');
      if (!response.ok) throw new Error('讀取待機設定失敗，請稍後重試。');
      const value: VersionedIdleSettings = await response.json() as VersionedIdleSettings;
      setSaved(value); setDraft({ items: value.items ?? [], isMuted: value.isMuted ?? true, marquee: value.marquee ?? DefaultIdleSettings.marquee });
    } catch (loadError: unknown) { setError(loadError instanceof Error ? loadError.message : '讀取待機設定失敗。'); }
    finally { setIsLoading(false); }
  }

  useEffect(() => { void loadSettings(); }, []);
  useEffect(() => {
    function warnBeforeLeave(event: BeforeUnloadEvent): void { if (isDirty) { event.preventDefault(); event.returnValue = ''; } }
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [isDirty]);

  useEffect(() => {
    if (!isPreviewOpen || draft.items.length === 0) return undefined;
    const media: IdleMedia = draft.items[previewIndex % draft.items.length];
    if (media.kind === 'video') return undefined;
    const pages: string[] = media.kind === 'pdf' && media.pageUrls?.length ? media.pageUrls : [media.url];
    if (draft.items.length === 1 && pages.length === 1) return undefined;
    const timer: number = window.setTimeout(() => {
      if (previewPage + 1 < pages.length) setPreviewPage(previewPage + 1);
      else { setPreviewPage(0); setPreviewIndex((previewIndex + 1) % draft.items.length); }
    }, media.durationSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [draft.items, isPreviewOpen, previewIndex, previewPage]);

  function updateDraft(changes: Partial<IdleSettings>): void { setDraft((current: IdleSettings) => ({ ...current, ...changes })); setMessage(''); }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files: File[] = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length) return;
    setIsUploading(true);
    setError(''); let completed: number = 0; const failures: string[] = [];
    for (const [fileIndex, file] of files.entries()) {
      const extension: string = file.name.split('.').pop()?.toLowerCase() ?? '';
      const kind: IdleMediaKind | null = extension === 'png' || extension === 'jpg' || extension === 'jpeg' ? 'image' : extension === 'gif' ? 'gif' : extension === 'mp4' ? 'video' : extension === 'pdf' ? 'pdf' : null;
      if (kind === null) { failures.push(`${file.name}：格式不支援`); continue; }
      if (file.size > sizeLimits[kind] * 1024 * 1024) { failures.push(`${file.name}：超過 ${sizeLimits[kind]} MB 上限`); continue; }
      setUploadStatus(`正在上傳 ${fileIndex + 1}/${files.length}：${file.name}`);
      const body: FormData = new FormData(); body.append('media', file); body.append('displayName', file.name);
      try {
        const response: Response = await fetch('/api/media', { method: 'POST', body });
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? '上傳失敗');
        const payload: { media: IdleMedia } = await response.json() as { media: IdleMedia };
        setDraft((current: IdleSettings) => ({ ...current, items: [...current.items, { ...payload.media, durationSeconds: payload.media.durationSeconds || 10 }] })); completed += 1;
      } catch (uploadError: unknown) { failures.push(`${file.name}：${uploadError instanceof Error ? uploadError.message : '上傳失敗'}`); }
    }
    setUploadStatus('');
    setIsUploading(false);
    if (failures.length) setError(`已加入 ${completed} 個檔案；${failures.join('；')}`);
    else setMessage(`已加入 ${completed} 個檔案，儲存後才會套用至播放清單。`);
  }

  async function openLibrary(): Promise<void> {
    setIsLibraryOpen(true); setIsLibraryLoading(true); setLibraryError(''); setSelectedLibraryUrls([]); setLibrarySearch('');
    try {
      const response: Response = await fetch('/api/media');
      if (!response.ok) throw new Error('無法讀取現有媒體，請重新載入。');
      const result: { items: IdleMedia[] } = await response.json() as { items: IdleMedia[] };
      setLibraryItems(result.items);
    } catch (failure: unknown) { setLibraryError(failure instanceof Error ? failure.message : '無法讀取現有媒體。'); }
    finally { setIsLibraryLoading(false); }
  }

  function addLibrarySelection(): void {
    const selected: IdleMedia[] = libraryItems.filter((item: IdleMedia) => selectedLibraryUrls.includes(item.url));
    if (draft.items.length + selected.length > 200) { setLibraryError('播放清單最多可加入 200 項。'); return; }
    setDraft((current: IdleSettings) => ({ ...current, items: [...current.items, ...selected.map((item: IdleMedia) => ({ ...item, id: 'playlist-' + Date.now() + '-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (value: number) => value.toString(16).padStart(2, '0')).join('') }))] }));
    setIsLibraryOpen(false); setMessage('已加入現有媒體，請儲存變更。');
  }

  function moveItem(index: number, offset: number): void {
    const destination: number = index + offset; if (destination < 0 || destination >= draft.items.length) return;
    const items: IdleMedia[] = [...draft.items]; const current: IdleMedia = items[index]; items[index] = items[destination]; items[destination] = current; updateDraft({ items });
  }

  const hasInvalidMarqueeNumbers: boolean = (draft.marquee.fontSizePx !== undefined && (!Number.isInteger(draft.marquee.fontSizePx) || draft.marquee.fontSizePx < 12 || draft.marquee.fontSizePx > 120)) ||
    (draft.marquee.speedPixelsPerSecond !== undefined && (!Number.isInteger(draft.marquee.speedPixelsPerSecond) || draft.marquee.speedPixelsPerSecond < 10 || draft.marquee.speedPixelsPerSecond > 500));

  async function saveSettings(): Promise<void> {
    if (saved === null || hasInvalidMarqueeNumbers) return;
    setIsSaving(true); setError(''); setConflict(false);
    try {
      const response: Response = await fetch('/api/idle-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: saved.version, ...draft }) });
      if (response.status === 409) { setConflict(true); setError('設定已在其他地方更新。請重新載入最新版本後再編輯。'); return; }
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? '儲存失敗，請稍後重試。');
      const result: VersionedIdleSettings = await response.json() as VersionedIdleSettings;
      // 只更新已儲存快照，保留等待回應期間新增的草稿修改。
      setSaved(result);
      setMessage('本次送出的待機播放設定已儲存。');
    } catch (saveError: unknown) { setError(saveError instanceof Error ? saveError.message : '儲存失敗。'); }
    finally { setIsSaving(false); }
  }

  function openPreview(): void { setPreviewIndex(0); setPreviewPage(0); setIsPreviewOpen(true); }
  const currentPreview: IdleMedia | undefined = draft.items[previewIndex];
  const previewPages: string[] = currentPreview?.kind === 'pdf' && currentPreview.pageUrls?.length ? currentPreview.pageUrls : currentPreview ? [currentPreview.url] : [];

  return <div className="management-app">
    <header className="management-topbar"><a className="management-brand" href="/settings" aria-label="BrightSign 日常管理首頁"><span className="management-mark">B</span><span>BrightSign<small>DAILY MANAGEMENT</small></span></a><div className="management-heading"><span>待機內容</span><span className="management-crumb">/</span><h1>日常管理</h1></div><nav className="management-nav"><a href="/engineering" aria-label="前往工程設定"><span aria-hidden="true">⚙</span> 工程設定</a><span className={`management-save-state ${isDirty ? 'is-dirty' : ''}`}><i />{isDirty ? '有未儲存變更' : '已儲存'}</span><button className="management-save" onClick={() => void saveSettings()} disabled={isLoading || isSaving || isUploading || saved === null || !isDirty || hasInvalidMarqueeNumbers}>{isSaving ? '儲存中…' : '儲存變更'}</button></nav></header>
    <main className="management-content">
      <section className="management-intro"><div><span className="management-kicker">STANDBY PLAYLIST</span><h2>管理待機播放內容</h2><p>新增圖片、影片或 PDF，設定播放順序；圖片與 PDF 可設定每頁顯示時間。</p></div><button className="management-preview-button" onClick={openPreview} disabled={!draft.items.length && (!draft.marquee.isEnabled || !draft.marquee.text.trim() || hasInvalidMarqueeNumbers)}>▷ 預覽待機畫面</button></section>
      <section className="management-card"><div className="management-card-title"><div><h2>播放清單 <span>{draft.items.length}</span></h2><p>單張圖片持續顯示；多項內容依序循環播放。影片播完切換下一項，單支影片自動重播。</p></div><button className="management-preview-button" type="button" disabled={isUploading || isLoading} onClick={() => void openLibrary()}>從現有媒體選取</button><label className="management-upload">＋ {isUploading ? '上傳中…' : '新增媒體'}<input type="file" accept=".png,.jpg,.jpeg,.gif,.mp4,.pdf" multiple disabled={isUploading} onChange={(event: ChangeEvent<HTMLInputElement>) => void uploadFiles(event)} /></label></div>
        <div className="management-size-hint">支援 PNG、JPG、GIF、MP4、PDF。單檔上限：圖片與 GIF 20 MB、影片 100 MB、PDF 30 MB。</div>
        {uploadStatus && <div className="management-notice" role="status">{uploadStatus}</div>}
        {isLoading ? <div className="management-empty" role="status">正在載入設定…</div> : draft.items.length === 0 ? <div className="management-empty"><span>▧</span><strong>播放清單目前是空的</strong><p>新增媒體後，待機畫面會依序循環播放。</p></div> : <ol className="management-playlist">{draft.items.map((item: IdleMedia, index: number) => <li className="management-media-row" key={item.id}><span className="management-index">{String(index + 1).padStart(2, '0')}</span><div className="management-thumb">{item.kind === 'image' || item.kind === 'gif' ? <img src={item.url} alt="" /> : item.kind === 'pdf' && item.pageUrls?.[0] ? <img src={item.pageUrls[0]} alt="" /> : <span>{item.kind === 'video' ? '▶' : 'PDF'}</span>}</div><div className="management-media-info"><input className="management-media-name" aria-label="媒體顯示名稱" maxLength={200} value={item.name} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft({ items: draft.items.map((media: IdleMedia, mediaIndex: number) => mediaIndex === index ? { ...media, name: event.target.value } : media) })} /><small>{item.kind.toUpperCase()}{item.kind === 'pdf' ? ` · ${item.pageUrls?.length ?? 1} 頁` : ''}</small></div><label className="management-duration">{item.kind === 'video' ? '播放方式' : draft.items.length === 1 && (item.kind !== 'pdf' || item.pageUrls?.length === 1) ? '顯示方式' : item.kind === 'pdf' ? '每頁顯示時間' : '顯示時間'}{item.kind === 'video' ? <span>{draft.items.length === 1 ? '播完自動重播' : '播完切換下一項'}</span> : draft.items.length === 1 && (item.kind !== 'pdf' || item.pageUrls?.length === 1) ? <span>持續顯示</span> : <><input aria-label={`${item.name} 的每頁停留秒數`} type="number" min={3} max={300} value={item.durationSeconds} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft({ items: draft.items.map((media: IdleMedia, mediaIndex: number) => mediaIndex === index ? { ...media, durationSeconds: Math.min(300, Math.max(3, Number(event.target.value) || 3)) } : media) })} /><span>秒{item.kind === 'pdf' ? '／頁' : ''}</span></>}</label><div className="management-row-actions"><button aria-label={`將 ${item.name} 上移`} title="上移" disabled={index === 0} onClick={() => moveItem(index, -1)}>↑</button><button aria-label={`將 ${item.name} 下移`} title="下移" disabled={index === draft.items.length - 1} onClick={() => moveItem(index, 1)}>↓</button><button className="management-remove" aria-label={`從清單移除 ${item.name}`} onClick={() => updateDraft({ items: draft.items.filter((_: IdleMedia, mediaIndex: number) => mediaIndex !== index) })}>移除</button></div></li>)}</ol>}
      </section>
      <div className="management-settings-grid"><section className="management-card management-audio-card"><div className="management-card-title"><div><h2>影片聲音</h2><p>預設靜音，避免待機播放打擾周遭。</p></div><label className="management-switch"><input type="checkbox" aria-label="播放影片聲音" checked={!draft.isMuted} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft({ isMuted: !event.target.checked })} /><span aria-hidden="true" /><strong>{draft.isMuted ? '靜音' : '開啟聲音'}</strong></label></div>{!draft.isMuted && <p className="management-audio-note">開啟聲音可能需要在播放裝置上允許播放音訊。</p>}</section>
      <section className="management-card"><div className="management-card-title"><div><h2>跑馬燈</h2><p>設定公告位置、字體大小及速度；數值越大，移動越快。</p></div><label className="management-switch"><input type="checkbox" aria-label="啟用跑馬燈" checked={draft.marquee.isEnabled} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft({ marquee: { ...draft.marquee, isEnabled: event.target.checked } })} /><span aria-hidden="true" /><strong>{draft.marquee.isEnabled ? '已開啟' : '已關閉'}</strong></label></div><label className="management-field">公告文字<textarea rows={3} maxLength={500} value={draft.marquee.text} placeholder="輸入要顯示的公告內容…" onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateDraft({ marquee: { ...draft.marquee, text: event.target.value } })} /></label><label className="management-field management-speed">顯示位置<select value={draft.marquee.position ?? 'bottom'} onChange={(event: ChangeEvent<HTMLSelectElement>) => updateDraft({ marquee: { ...draft.marquee, position: event.currentTarget.value as 'top' | 'bottom' } })}><option value="top">畫面上方</option><option value="bottom">畫面下方</option></select></label><div className="management-marquee-controls"><label className="management-field">字體大小（像素）<input type="number" min={12} max={120} step={1} value={Number.isFinite(draft.marquee.fontSizePx ?? 30) ? draft.marquee.fontSizePx ?? 30 : ''} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft({ marquee: { ...draft.marquee, fontSizePx: event.currentTarget.valueAsNumber } })} /><small>12–120 像素，數字越大，文字越大。</small></label><label className="management-field">移動速度（像素／秒）<input type="number" min={10} max={500} step={1} placeholder="沿用舊版速度" value={draft.marquee.speedPixelsPerSecond !== undefined && Number.isFinite(draft.marquee.speedPixelsPerSecond) ? draft.marquee.speedPixelsPerSecond : ''} onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft({ marquee: { ...draft.marquee, speedPixelsPerSecond: event.currentTarget.valueAsNumber } })} /><small>10–500 像素／秒，建議 80。長短公告維持相同速度。{draft.marquee.speedPixelsPerSecond === undefined && '目前沿用舊版速度，輸入數值後套用新方式。'}</small></label></div>{hasInvalidMarqueeNumbers && <p role="alert" className="management-feedback is-error">請輸入範圍內的整數：字體 12–120、速度 10–500。</p>}<p className="management-field">公告預覽（依目前設定顯示）</p>{!hasInvalidMarqueeNumbers && draft.marquee.isEnabled && draft.marquee.text.trim() ? <MarqueePreview settings={draft.marquee} className="management-marquee-preview" /> : <p className="management-field">{hasInvalidMarqueeNumbers ? '修正數值後即可預覽。' : '啟用跑馬燈並輸入公告文字後即可預覽。'}</p>}</section></div>
      <aside className="management-alarm-note"><span aria-hidden="true">ⓘ</span><p>警報觸發時會自動切換至警報畫面；解除後再繼續播放待機內容。</p></aside>
      {message && <div className="management-feedback is-success" role="status">{message}</div>}{error && <div className="management-feedback is-error" role="alert">{error}{conflict && <button onClick={() => { if (window.confirm('重新載入會捨棄目前尚未儲存的變更，確定繼續嗎？')) void loadSettings(); }}>重新載入最新設定</button>}{saved === null && !isLoading && <button onClick={() => void loadSettings()}>重新載入</button>}</div>}
    </main>
    {isLibraryOpen && <div className="management-library-backdrop"><section className="management-library-dialog" role="dialog" aria-modal="true" aria-label="現有媒體"><header><div><h2>從現有媒體選取</h2><p>可重複使用已上傳的檔案，無須再上傳。</p></div><button type="button" aria-label="關閉現有媒體" onClick={() => setIsLibraryOpen(false)}>×</button></header><input aria-label="搜尋現有媒體" placeholder="搜尋檔案名稱" value={librarySearch} onChange={(event: ChangeEvent<HTMLInputElement>) => setLibrarySearch(event.currentTarget.value)} />{libraryError && <p role="alert">{libraryError}<button type="button" onClick={() => void openLibrary()}>重新載入</button></p>}{isLibraryLoading ? <p>正在讀取現有媒體…</p> : <div className="management-library-grid">{libraryItems.filter((item: IdleMedia) => item.name.toLocaleLowerCase().includes(librarySearch.toLocaleLowerCase())).map((item: IdleMedia) => <label key={item.url} className="management-library-item"><input type="checkbox" checked={selectedLibraryUrls.includes(item.url)} onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedLibraryUrls((current: string[]) => event.target.checked ? [...current, item.url] : current.filter((url: string) => url !== item.url))} />{item.kind === 'video' ? <span className="management-library-thumbnail">▶ MP4</span> : <img src={item.kind === 'pdf' ? item.pageUrls?.[0] : item.url} alt="" />}<strong>{item.name}</strong><small>{item.kind.toUpperCase()}{item.kind === 'pdf' ? ' · ' + item.pageUrls?.length + ' 頁' : ''}</small></label>)}{libraryItems.length === 0 && <p>尚未有可選用的媒體，請先上傳檔案。</p>}</div>}<footer><span>已選取 {selectedLibraryUrls.length} 項</span><button type="button" className="management-save" disabled={selectedLibraryUrls.length === 0} onClick={addLibrarySelection}>加入播放清單</button></footer></section></div>}
    {isPreviewOpen && <div className="management-preview-overlay" role="dialog" aria-modal="true" aria-label="待機畫面預覽"><div className="management-preview-screen"><button className="management-preview-close" onClick={() => setIsPreviewOpen(false)} aria-label="關閉預覽">×</button>{currentPreview ? currentPreview.kind === 'video' ? <video key={currentPreview.id} src={currentPreview.url} autoPlay loop={draft.items.length === 1} muted={draft.isMuted} controls onEnded={() => { setPreviewIndex((previewIndex + 1) % draft.items.length); setPreviewPage(0); }} /> : <img src={previewPages[previewPage]} alt={`${currentPreview.name} 預覽`} /> : <p>尚無待機媒體</p>}{!hasInvalidMarqueeNumbers && draft.marquee.isEnabled && draft.marquee.text.trim() && <MarqueePreview settings={draft.marquee} className="management-preview-ticker" />}<div className="management-preview-caption">{currentPreview?.name ?? '待機預覽'}{currentPreview?.kind === 'pdf' ? ` · 第 ${previewPage + 1} / ${previewPages.length} 頁` : ''}</div></div></div>}
  </div>;
}

export default ManagementApp;
