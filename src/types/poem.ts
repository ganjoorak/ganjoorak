export interface PoemRecitation {
  id: number;
  poemId: number;
  poemFullTitle: string;
  poemFullUrl: string;
  audioTitle: string;
  audioArtist: string;
  audioArtistUrl: string;
  audioSrc: string;
  audioSrcUrl: string;
  legacyAudioGuid: string;
  mp3FileCheckSum: string;
  mp3SizeInBytes: number;
  publishDate: string;
  fileLastUpdated: string;
  mp3Url: string;
  xmlText: string;
  plainText: string;
  htmlText: string;
  mistakes: any[];
  audioOrder: number;
  recitationType: number;
  inSyncWithText: boolean;
  upVotedByUser: boolean;
}

export interface Poem {
  id: number;
  title: string;
  fullTitle: string;
  poet: string;
  poetNickname: string;
  poetSlug: string;
  poetImageUrl: string;
  urlSlug: string;
  fullUrl: string;
  plainText: string;
  htmlText: string;
  /**
   * Per non-empty line of plainText: "prose" for Ganjoor paragraph blocks
   * (class n), "verse" for mesras. Missing on older cached payloads.
   */
  lineKinds?: Array<"verse" | "prose">;
  recitations: PoemRecitation[];
  isCustom?: boolean;
  source?: "ganjoor" | "custom" | "echolalia";
}

export interface VerseSync {
  verseOrder: number;
  verseText: string;
  audioStartMilliseconds: number;
}

export interface PoemViewerProps {
  poem: Poem;
  onNext: (poem?: Poem) => void;
  onPrevious: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export interface ErrorScreenProps {
  message: string;
  onRetry?: () => void;
}
