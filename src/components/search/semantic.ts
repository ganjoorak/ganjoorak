import type { GanjoorSemanticVerse } from "@/types/ganjoor";
import { LruCache } from "@/utils/searchCache";

export interface SemanticHit {
  key: string;
  id: number;
  title: string;
  poetName: string;
  avatarUrl: string | null;
  collection: string | null;
  href: string;
  verses: GanjoorSemanticVerse[];
}

export interface SemanticState {
  status: "idle" | "loading" | "done" | "error";
  hits: SemanticHit[];
  scopePoet: string | null;
  scopeCategory: string | null;
}

export const semanticCache = new LruCache<SemanticState>(30);
export const idleSemantic: SemanticState = { status: "idle", hits: [], scopePoet: null, scopeCategory: null };
