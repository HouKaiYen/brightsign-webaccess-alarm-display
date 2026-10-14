import { useState } from 'react';
import type { JSX } from 'react';
import { getSystemStatus, setMonitoring, setStartupEnabled } from '../services/systemControlsApi';
import type { SystemStatus } from '../services/systemControlsApi';

interface SystemControlsProps {
  disabled?: boolean;
}

export function SystemControls({ disabled = false }: SystemControlsProps): JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  async function refreshStatus(): Promise<void> {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const latestStatus: SystemStatus = await getSystemStatus();
      setStatus(latestStatus);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, '無法讀取系統狀態。'));
    } finally {
      setIsLoading(false);
    }
  }

  async function openControls(): Promise<void> {
    setIsOpen(true);
    await refreshStatus();
  }

  async function toggleMonitoring(): Promise<void> {
    if (status === null || isUpdating) return;
    setIsUpdating(true);
    setErrorMessage('');
    try {
      const updatedStatus: SystemStatus = await setMonitoring(!status.isMonitoring);
      setStatus(updatedStatus);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, '更新警報監控狀態失敗。'));
    } finally {
      setIsUpdating(false);
    }
  }

  async function toggleStartup(): Promise<void> {
    if (status?.isStartupEnabled === null || status === null || isUpdating) return;
    setIsUpdating(true);
    setErrorMessage('');
    try {
      const updatedStatus: SystemStatus = await setStartupEnabled(!status.isStartupEnabled);
      setStatus(updatedStatus);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, '更新 Windows 自動啟動設定失敗。'));
    } finally {
      setIsUpdating(false);
    }
  }

  const canControlStartup: boolean = status?.isPortable === true && status.canManageStartup;

  return (
    <>
      <button className="secondary-button system-controls-trigger" type="button" disabled={disabled} onClick={() => void openControls()}>系統控制</button>
      {isOpen && (
        <div className="dialog-backdrop system-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
          <section className="system-dialog" role="dialog" aria-modal="true" aria-labelledby="system-controls-title">
            <div className="system-dialog-heading">
              <div><span className="section-kicker">服務管理</span><h2 id="system-controls-title">系統控制</h2><p>控制警報監控及 Windows 啟動行為。</p></div>
              <button className="dialog-close-button" type="button" onClick={() => setIsOpen(false)} aria-label="關閉系統控制">×</button>
            </div>
            {isLoading && <div className="connection-loading"><span className="loading-spinner" /><span>正在讀取系統狀態…</span></div>}
            {errorMessage && <div className="connection-error" role="alert"><span>{errorMessage}</span><button className="text-button" type="button" disabled={isLoading || isUpdating} onClick={() => void refreshStatus()}>重新整理狀態</button></div>}
            {!isLoading && status !== null && (
              <>
                {!errorMessage && <button className="status-refresh-button" type="button" disabled={isUpdating} onClick={() => void refreshStatus()}>重新整理狀態</button>}
                <section className="system-control-card">
                  <div><span className="system-card-label">警報監控</span><strong className={`system-state${status.isMonitoring ? ' is-running' : ' is-stopped'}`}>{status.isMonitoring ? '監控中' : '已停止'}</strong><p>停止監控只會暫停警報輪詢，已儲存的測點及平面圖設定會保留。</p></div>
                  <button className={status.isMonitoring ? 'danger-control-button' : 'primary-button'} type="button" disabled={isUpdating} onClick={() => void toggleMonitoring()}>{isUpdating ? '處理中…' : status.isMonitoring ? '停止警報監控' : '開始警報監控'}</button>
                </section>
                <section className="system-control-card startup-control-card">
                  <div><span className="system-card-label">Windows 自動啟動</span><strong className={`system-state${status.isStartupEnabled === true ? ' is-running' : ' is-stopped'}`}>{status.isStartupEnabled === null ? '狀態未知' : status.isStartupEnabled ? '已啟用' : '未啟用'}</strong>
                    {canControlStartup
                      ? <p>設定此服務是否在 Windows 啟動時自動執行。</p>
                      : <p>此功能需在服務主機以 localhost 開啟設定頁，且僅適用於可管理自動啟動的便攜版部署。</p>}
                    {status.startupMessage && <p className="startup-message" role="status">{status.startupMessage}</p>}
                  </div>
                  {canControlStartup && <button className={status.isStartupEnabled ? 'danger-control-button' : 'secondary-button'} type="button" disabled={isUpdating || status.isStartupEnabled === null} onClick={() => void toggleStartup()}>{isUpdating ? '處理中…' : status.isStartupEnabled ? '停用自動啟動' : '啟用自動啟動'}</button>}
                </section>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
