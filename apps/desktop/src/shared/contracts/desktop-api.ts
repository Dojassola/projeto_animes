import type { AppStatusResult } from './app';
import type {
  CatalogCancelInput,
  CatalogCancelResult,
  CatalogCollectionResult,
  CatalogDetailsInput,
  CatalogDetailsResult,
  CatalogHomeInput,
  CatalogSearchInput,
  EpisodeDetailsInput,
  EpisodeDetailsResult,
  WatchlistResult,
  WatchlistSetInput,
  WatchlistSetResult,
} from './catalog';
import type {
  ChooseDownloadPathResult,
  IntegrationSettingsResult,
  MediaCancelInput,
  OperationResult,
  ReleaseDownloadInput,
  ReleaseDownloadResult,
  ReleaseSearchInput,
  ReleaseSearchResult,
  SubtitleDownloadInput,
  SubtitleDownloadResult,
  SubtitleSearchInput,
  SubtitleSearchResult,
  TorrentControlInput,
  TorrentStartInput,
  TorrentStartResult,
  TorrentStatusResult,
  UpdateIntegrationSettingsInput,
} from './media';
import type { Settings, SettingsResult } from './settings';

export interface KitsuneDesktopApi {
  app: {
    getStatus(): Promise<AppStatusResult>;
  };
  settings: {
    get(): Promise<SettingsResult>;
    update(input: Settings): Promise<SettingsResult>;
  };
  catalog: {
    home(input: CatalogHomeInput): Promise<CatalogCollectionResult>;
    search(input: CatalogSearchInput): Promise<CatalogCollectionResult>;
    getDetails(input: CatalogDetailsInput): Promise<CatalogDetailsResult>;
    getEpisodeDetails(input: EpisodeDetailsInput): Promise<EpisodeDetailsResult>;
    cancel(input: CatalogCancelInput): Promise<CatalogCancelResult>;
  };
  watchlist: {
    get(): Promise<WatchlistResult>;
    set(input: WatchlistSetInput): Promise<WatchlistSetResult>;
  };
  integrations: {
    get(): Promise<IntegrationSettingsResult>;
    update(input: UpdateIntegrationSettingsInput): Promise<IntegrationSettingsResult>;
    chooseDownloadPath(): Promise<ChooseDownloadPathResult>;
  };
  releases: {
    search(input: ReleaseSearchInput): Promise<ReleaseSearchResult>;
    download(input: ReleaseDownloadInput): Promise<ReleaseDownloadResult>;
    cancel(input: MediaCancelInput): Promise<OperationResult>;
  };
  torrents: {
    start(input: TorrentStartInput): Promise<TorrentStartResult>;
    status(): Promise<TorrentStatusResult>;
    control(input: TorrentControlInput): Promise<OperationResult>;
  };
  subtitles: {
    search(input: SubtitleSearchInput): Promise<SubtitleSearchResult>;
    download(input: SubtitleDownloadInput): Promise<SubtitleDownloadResult>;
  };
}
