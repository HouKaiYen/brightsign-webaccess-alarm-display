import type { ActiveAlarm, AlarmSettings, DisplayState } from '../../shared/contracts.js';
import { EmptySettings } from '../../shared/contracts.js';
import type { ServerConfiguration } from '../config/environment.js';
import { SettingsStore } from './settingsStore.js';
import { WebAccessClient } from './webAccessClient.js';

interface AlarmObservation {
  alarm: ActiveAlarm;
  firstSeenAt: number;
}

export class AlarmMonitor {
  private readonly _configuration: ServerConfiguration;
  private readonly _settingsStore: SettingsStore;
  private readonly _webAccessClient: WebAccessClient;
  private readonly _firstSeenTimes: Map<string, number> = new Map<string, number>();
  private readonly _stateListeners: Set<(state: DisplayState) => void> = new Set<(state: DisplayState) => void>();
  private _alarms: ActiveAlarm[] = [];
  private _settings: AlarmSettings = EmptySettings;
  private _selectedPageId: string | null = null;
  private _connectionStatus: DisplayState['connectionStatus'];
  private _lastSuccessAt: string | null = null;
  private _pollingInterval: NodeJS.Timeout | null = null;
  private _activePoll: Promise<void> | null = null;
  private _isStopped: boolean = false;
  private _firstSeenSequence: number = 0;
  private _lifecycleQueue: Promise<void> = Promise.resolve();

  public constructor(configuration: ServerConfiguration, settingsStore: SettingsStore, webAccessClient: WebAccessClient) {
    this._configuration = configuration;
    this._settingsStore = settingsStore;
    this._webAccessClient = webAccessClient;
    this._connectionStatus = webAccessClient.isConfigured ? 'connecting' : 'disconnected';
  }

  public async initialize(): Promise<void> {
    this._settings = await this._settingsStore.getSettings();
  }

  public get isRunning(): boolean {
    return this._pollingInterval !== null;
  }

  public start(): void {
    void this.setIsRunning(true);
  }

  public async stop(): Promise<void> {
    await this.enqueueLifecycle<void>(() => this.stopMonitor());
  }

  public setIsRunning(isRunning: boolean): Promise<void> {
    return this.enqueueLifecycle<void>(async (): Promise<void> => {
      if (isRunning) {
        this.startMonitor();
      } else {
        await this.stopMonitor();
      }
    });
  }

  private async stopMonitor(): Promise<void> {
    this._isStopped = true;
    if (this._pollingInterval !== null) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
    await this._activePoll;
    this._connectionStatus = 'disconnected';
    this.publishState();
  }

  public getDisplayState(): DisplayState {
    const activeAlarms: ActiveAlarm[] = this.getOrderedAlarms();
    return {
      settings: this._settings,
      alarms: activeAlarms,
      selectedPageId: this._selectedPageId,
      connectionStatus: this._connectionStatus,
      lastSuccessAt: this._lastSuccessAt,
      isMonitoring: this.isRunning,
    };
  }

  public subscribe(listener: (state: DisplayState) => void): () => void {
    this._stateListeners.add(listener);
    listener(this.getDisplayState());
    return () => this._stateListeners.delete(listener);
  }

  public async updateSettings(settings: AlarmSettings): Promise<void> {
    this._settings = settings;
    this._selectedPageId = this.selectPageId(this.getOrderedAlarms());
    this.publishState();
  }

  public async reconfigureConnectionSettings<T>(updateConnectionSettings: () => Promise<T>): Promise<T> {
    return this.enqueueLifecycle<T>(async (): Promise<T> => {
      const wasRunning: boolean = this.isRunning;
      await this.stopMonitor();
      try {
        const result: T = await updateConnectionSettings();
        this._alarms = [];
        this._firstSeenTimes.clear();
        this._selectedPageId = null;
        this._lastSuccessAt = null;
        this._connectionStatus = wasRunning && this._webAccessClient.isConfigured ? 'connecting' : 'disconnected';
        this.publishState();
        if (wasRunning) {
          this.startMonitor();
        }
        return result;
      } catch (error: unknown) {
        if (wasRunning) {
          this.startMonitor();
        }
        throw error;
      }
    });
  }

  private enqueueLifecycle<T>(operation: () => Promise<T> | T): Promise<T> {
    const queuedOperation: Promise<T> = this._lifecycleQueue.then(operation);
    this._lifecycleQueue = queuedOperation.then(() => undefined, () => undefined);
    return queuedOperation;
  }

  private startMonitor(): void {
    if (this._pollingInterval !== null) {
      return;
    }
    this._isStopped = false;
    void this.startPoll();
    this._pollingInterval = setInterval(() => void this.startPoll(), this._configuration.pollIntervalMs);
  }

  private async startPoll(): Promise<void> {
    if (this._isStopped || this._activePoll !== null) {
      return;
    }
    this._activePoll = this.pollOnce();
    try {
      await this._activePoll;
    } finally {
      this._activePoll = null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this._webAccessClient.isConfigured) {
      this._connectionStatus = 'disconnected';
      this.publishState();
      return;
    }
    try {
      const updatedAlarms: ActiveAlarm[] = await this._webAccessClient.getActiveAlarms();
      const currentTime: number = Date.now();
      const observationsByName: Map<string, AlarmObservation> = new Map<string, AlarmObservation>();
      for (const alarm of updatedAlarms) {
        if (!this._firstSeenTimes.has(alarm.name)) {
          this._firstSeenSequence = this._firstSeenSequence >= 10000 ? 0 : this._firstSeenSequence + 1;
        }
        const firstSeenAt: number = this._firstSeenTimes.get(alarm.name) ?? currentTime + this._firstSeenSequence;
        this._firstSeenTimes.set(alarm.name, firstSeenAt);
        const currentObservation: AlarmObservation | undefined = observationsByName.get(alarm.name);
        if (currentObservation === undefined || this.compareObservation(alarm, currentObservation.alarm) > 0) {
          observationsByName.set(alarm.name, { alarm, firstSeenAt });
        }
      }
      for (const existingName of this._firstSeenTimes.keys()) {
        if (!observationsByName.has(existingName)) {
          this._firstSeenTimes.delete(existingName);
        }
      }

      this._alarms = [...observationsByName.values()].map((observation: AlarmObservation) => ({
        ...observation.alarm,
        occurredAt: Number.isNaN(observation.alarm.occurredAt) ? observation.firstSeenAt : observation.alarm.occurredAt,
      }));
      this._connectionStatus = 'connected';
      this._lastSuccessAt = new Date().toISOString();
      this._selectedPageId = this.selectPageId(this.getOrderedAlarms());
    } catch {
      this._connectionStatus = 'disconnected';
    }
    this.publishState();
  }

  private getOrderedAlarms(): ActiveAlarm[] {
    return [...this._alarms].sort((firstAlarm: ActiveAlarm, secondAlarm: ActiveAlarm) => secondAlarm.occurredAt - firstAlarm.occurredAt);
  }

  private selectPageId(alarms: ActiveAlarm[]): string | null {
    const markerByName: Map<string, string> = new Map<string, string>();
    for (const marker of this._settings.markers) {
      markerByName.set(marker.name, marker.pageId);
    }
    const candidates: Array<{ pageId: string; occurredAt: number; pageIndex: number }> = [];
    for (const alarm of alarms) {
      const pageId: string | undefined = markerByName.get(alarm.name);
      if (pageId !== undefined) {
        candidates.push({
          pageId,
          occurredAt: alarm.occurredAt,
          pageIndex: this._settings.pages.findIndex((page) => page.id === pageId),
        });
      }
    }
    if (candidates.length === 0) {
      return null;
    }

    const latestTime: number = Math.max(...candidates.map((candidate) => candidate.occurredAt));
    const latestPages: string[] = [...new Set(candidates
      .filter((candidate) => candidate.occurredAt === latestTime)
      .map((candidate) => candidate.pageId))];
    if (this._selectedPageId !== null && latestPages.includes(this._selectedPageId)) {
      return this._selectedPageId;
    }
    return latestPages.sort((firstId: string, secondId: string) =>
      this._settings.pages.findIndex((page) => page.id === firstId) - this._settings.pages.findIndex((page) => page.id === secondId))[0] ?? null;
  }

  private compareObservation(firstAlarm: ActiveAlarm, secondAlarm: ActiveAlarm): number {
    if (Number.isNaN(firstAlarm.occurredAt)) {
      return -1;
    }
    if (Number.isNaN(secondAlarm.occurredAt)) {
      return 1;
    }
    return firstAlarm.occurredAt - secondAlarm.occurredAt;
  }

  private publishState(): void {
    const state: DisplayState = this.getDisplayState();
    for (const listener of this._stateListeners) {
      listener(state);
    }
  }
}
