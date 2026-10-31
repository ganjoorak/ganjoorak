import { Poem } from '@/types/poem';
import { logger } from '@/utils/logger';

const FEED_CACHE_KEY = 'ganjoorak:latest-feed-poems:v2';
const FEED_CACHE_LIMIT = 8;

type CachedFeed = {
    poems: Poem[];
    savedAt: number;
    interestKey?: string | null;
};

export const readCachedFeed = () => {
    const empty = { poems: [] as Poem[], interestKey: '' };

    if (typeof window === 'undefined') {
        return empty;
    }

    try {
        const rawCache = window.localStorage.getItem(FEED_CACHE_KEY);
        if (!rawCache) {
            return empty;
        }

        const parsed = JSON.parse(rawCache) as Partial<CachedFeed>;
        if (!Array.isArray(parsed.poems)) {
            return empty;
        }

        return {
            poems: parsed.poems.filter((poem): poem is Poem => Boolean(poem?.id && poem?.plainText)),
            interestKey: typeof parsed.interestKey === 'string' ? parsed.interestKey : '',
        };
    } catch (error) {
        logger.error('Failed to read cached feed poems:', error);
        return empty;
    }
};

/** Marks a cache holding a poem handed to the feed: it fits any feed mode and is kept instead of refetched. */
export const HANDED_OFF_FEED_KEY = 'handed-off';

/** Makes the poem the one the home feed opens on; the feed then fills up behind it. */
export const handOffPoemToFeed = (poem: Poem) => {
    writeCachedFeedPoems([poem], 0, HANDED_OFF_FEED_KEY);
};

export const writeCachedFeedPoems = (
    poems: Poem[],
    currentIndex: number,
    interestKey: string,
) => {
    if (typeof window === 'undefined' || poems.length === 0) {
        return;
    }

    try {
        const currentPoem = poems[currentIndex] ?? poems[0];
        const orderedPoems = [
            currentPoem,
            ...poems.filter((poem) => poem.id !== currentPoem.id),
        ].slice(0, FEED_CACHE_LIMIT);

        window.localStorage.setItem(
            FEED_CACHE_KEY,
            JSON.stringify({
                poems: orderedPoems,
                savedAt: Date.now(),
                interestKey,
            } satisfies CachedFeed),
        );
    } catch (error) {
        logger.error('Failed to cache feed poems:', error);
    }
};
