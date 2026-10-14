import { io, type Socket } from 'socket.io-client';
import type { DisplayState } from '../../shared/contracts';

export type DisplayStateListener = (state: DisplayState) => void;
export type ConnectionListener = (isConnected: boolean) => void;

export interface DisplayTransport {
  close(): void;
}

function isDisplayState(value: unknown): value is DisplayState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate: Partial<DisplayState> = value as Partial<DisplayState>;
  return typeof candidate.settings === 'object'
    && candidate.settings !== null
    && Array.isArray(candidate.settings.pages)
    && Array.isArray(candidate.settings.markers)
    && Array.isArray(candidate.alarms)
    && (typeof candidate.selectedPageId === 'string' || candidate.selectedPageId === null)
    && (candidate.connectionStatus === 'connecting'
      || candidate.connectionStatus === 'connected'
      || candidate.connectionStatus === 'disconnected')
    && (typeof candidate.lastSuccessAt === 'string' || candidate.lastSuccessAt === null);
}

export function connectDisplayTransport(
  onState: DisplayStateListener,
  onConnection: ConnectionListener,
): DisplayTransport {
  const socket: Socket = io({ autoConnect: true, reconnection: true });
  let isClosed: boolean = false;
  let requestSequence: number = 0;
  let newestAppliedSequence: number = 0;
  let activeFetch: Promise<void> | null = null;
  let pendingFetch: boolean = false;
  let activeController: AbortController | null = null;

  const fetchState: () => Promise<void> = async (): Promise<void> => {
    if (isClosed) {
      return;
    }
    if (activeFetch !== null) {
      pendingFetch = true;
      return activeFetch;
    }

    const sequence: number = ++requestSequence;
    const controller: AbortController = new AbortController();
    activeController = controller;
    const timeoutId: number = window.setTimeout((): void => controller.abort(), 8000);
    const request: Promise<void> = fetch('/api/display-state', { cache: 'no-store', signal: controller.signal })
      .then(async (response: Response): Promise<unknown> => {
        if (!response.ok) {
          throw new Error(`顯示狀態讀取失敗 (${response.status})`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload: unknown): void => {
        if (isClosed || sequence < newestAppliedSequence) {
          return;
        }
        if (!isDisplayState(payload)) {
          throw new Error('顯示狀態資料格式錯誤');
        }
        newestAppliedSequence = sequence;
        onState(payload);
        onConnection(true);
      })
      .catch((): void => {
        if (!isClosed && sequence >= newestAppliedSequence) {
          onConnection(false);
        }
      })
      .finally((): void => {
        window.clearTimeout(timeoutId);
        if (activeController === controller) {
          activeController = null;
        }
        activeFetch = null;
        if (pendingFetch && !isClosed) {
          pendingFetch = false;
          void fetchState();
        }
      });

    activeFetch = request;
    return request;
  };

  socket.on('connect', (): void => {
    onConnection(true);
    void fetchState();
  });
  socket.on('disconnect', (): void => onConnection(false));
  socket.on('connect_error', (): void => onConnection(false));
  socket.on('display-state', (value: unknown): void => {
    if (!isDisplayState(value)) {
      return;
    }
    newestAppliedSequence = ++requestSequence;
    onState(value);
    onConnection(true);
  });

  void fetchState();
  const pollTimer: number = window.setInterval((): void => { void fetchState(); }, 10000);

  return {
    close(): void {
      isClosed = true;
      window.clearInterval(pollTimer);
      activeController?.abort();
      socket.disconnect();
    },
  };
}
