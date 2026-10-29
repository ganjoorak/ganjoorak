import { Poet } from '@/types/poet';
import poetSourceIndex from '@/data/poet-source-index.json';

export const getPoetKey = (poet: Pick<Poet, 'source' | 'urlSlug' | 'fullUrl' | 'id'>) => {
    const source = poet.source || 'ganjoor';
    const slug = poet.urlSlug || poet.fullUrl.replace(/^\/+/, '') || String(poet.id);
    return `${source}:${slug}`;
};

export const getPoetDisplayName = (poet: Poet) => poet.nickname || poet.name;
export type FeedPoetSource = NonNullable<Poet['source']>;
type PoetSourceIndexEntry = {
    source: 'ganjoor' | 'echolalia';
    id?: number | null;
};

const indexedPoetSources = poetSourceIndex.sourcesBySlug as Record<
    string,
    PoetSourceIndexEntry | undefined
>;

export const parsePreferredPoetKey = (key: string): { source: FeedPoetSource; slug: string } | null => {
    const separatorIndex = key.indexOf(':');
    const source = separatorIndex >= 0 ? key.slice(0, separatorIndex) : 'ganjoor';
    const slug = separatorIndex >= 0 ? key.slice(separatorIndex + 1) : key;

    if (!slug) {
        return null;
    }

    if (source === 'custom' || source === 'echolalia' || source === 'ganjoor') {
        return { source, slug };
    }

    return { source: 'ganjoor', slug };
};

export const getIndexedGanjoorPoetId = (slug: string) => {
    const entry = indexedPoetSources[slug];
    return entry?.source === 'ganjoor' && typeof entry.id === 'number'
        ? entry.id
        : null;
};
