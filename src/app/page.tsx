'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PoemFeedPager from '@/components/PoemFeedPager';
import LoadingScreen from '@/components/LoadingScreen';
import ErrorScreen from '@/components/ErrorScreen';
import ganjoorApi from '@/api/GanjoorApi';
import customApi from '@/api/CustomApi';
import echolaliaApi from '@/api/EcholaliaApi';
import { Poem } from '@/types/poem';
import { Poet, isValidPoetSlug } from '@/types/poet';
import { useSettings } from '@/context/SettingsContext';
import { logger } from '@/utils/logger';
import { FaRegStar } from 'react-icons/fa';
import Link from 'next/link';
import FeedModeSwitch from '@/components/FeedModeSwitch';
import FeedModeEmpty from '@/components/FeedModeEmpty';
import { buttonVariants } from '@/components/ui/button';
import { FeedMode } from '@/context/SettingsContext';
import { fetchSimilarPoem } from '@/utils/interestFeed';
import { fetchRandomGanjoorPoem, fetchRandomPoemByPoetId } from '@/utils/poemIndex';
import { useLovedCollections } from '@/hooks/useLovedCollections';
import { fetchRandomPoemFromCollection } from '@/utils/collectionFeed';
import { readCachedFeed, writeCachedFeedPoems } from '@/utils/feedCache';
import { getPoetDisplayName, parsePreferredPoetKey, getIndexedGanjoorPoetId } from '@/utils/feedPoets';
import FeedPoetDialog from '@/components/FeedPoetDialog';
import FollowingStoriesChip from '@/components/stories/FollowingStoriesChip';

const INITIAL_POEMS_COUNT = 12;
const PREFETCH_THRESHOLD = 5;
const BATCH_SIZE = 6;
const POEM_FETCH_CONCURRENCY = 3;
const SIMILAR_POEM_SHARE = 0.25;
export default function Home() {
    const {
        settings,
        isHydrated: areSettingsHydrated,
        setPreferredPoetKeys,
        setFeedMode,
    } = useSettings();
    const feedMode = settings.feedMode;
    const isPreferredMode = feedMode === 'preferred';
    // The «علاقه‌مندی‌ها» feed draws from preferred poets and loved books alike.
    const { collections: lovedCollections } = useLovedCollections();
    const hasNoPreferred = settings.preferredPoetKeys.length === 0 && lovedCollections.length === 0;
    const isPreferredEmpty = isPreferredMode && hasNoPreferred;
    const [poems, setPoems] = useState<Poem[]>([]);
    const [availablePoets, setAvailablePoets] = useState<Poet[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentPoemIndex, setCurrentPoemIndex] = useState(0);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [isFeedDialogOpen, setIsFeedDialogOpen] = useState(false);
    const [shouldClearFeedQuery, setShouldClearFeedQuery] = useState(false);
    const poemsRef = useRef<Poem[]>([]);
    const currentPoemIndexRef = useRef(0);
    const feedVersionRef = useRef(0);
    const fetchMorePromiseRef = useRef<Promise<Poem[]> | null>(null);
    const pendingNavigationIndexRef = useRef<number | null>(null);
    const loadedPoetsRef = useRef(false);
    const hydratedFeedSignatureRef = useRef<string | null>(null);
    const cachedInterestKeyRef = useRef<string>('');

    useEffect(() => {
        const cachedFeed = readCachedFeed();
        if (cachedFeed.poems.length > 0) {
            cachedInterestKeyRef.current = cachedFeed.interestKey;
            setPoems((current) => (current.length > 0 ? current : cachedFeed.poems));
        }
    }, []);

    useEffect(() => {
        poemsRef.current = poems;
    }, [poems]);


    useEffect(() => {
        currentPoemIndexRef.current = currentPoemIndex;
    }, [currentPoemIndex]);

    useEffect(() => {
        if (currentPoemIndex >= poems.length && poems.length > 0) {
            setCurrentPoemIndex(poems.length - 1);
        }
    }, [currentPoemIndex, poems.length]);

    useEffect(() => {
        const pendingIndex = pendingNavigationIndexRef.current;

        if (pendingIndex === null || pendingIndex >= poems.length) {
            return;
        }

        pendingNavigationIndexRef.current = null;
        setCurrentPoemIndex(pendingIndex);
    }, [poems.length]);

    const preferredKeySignature = [
        ...settings.preferredPoetKeys,
        ...lovedCollections.map((collection) => collection.key),
    ].join('|');
    // «همه» never depends on preferred poets.
    const feedSignature = isPreferredMode
        ? `preferred::${preferredKeySignature}`
        : 'all';

    useEffect(() => {
        writeCachedFeedPoems(poems, currentPoemIndex, feedSignature);
    }, [feedSignature, currentPoemIndex, poems]);
    const currentPoem = poems[currentPoemIndex];
    const nextPoem = poems[currentPoemIndex + 1];

    const clearFeedQuery = useCallback(() => {
        if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', '/');
        }
        setShouldClearFeedQuery(false);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const params = new URLSearchParams(window.location.search);

        if (params.get('feed') === '1') {
            setIsFeedDialogOpen(true);
            setShouldClearFeedQuery(true);
        }
    }, []);

    useEffect(() => {
        if (!areSettingsHydrated || loadedPoetsRef.current || !currentPoem) {
            return;
        }

        let isCancelled = false;

        const loadPoets = async () => {
            try {
                const [ganjoorPoets, customPoets, modernPoets] = await Promise.all([
                    ganjoorApi.getPoets(),
                    customApi.getPoets(),
                    echolaliaApi.getPoets(),
                ]);

                if (isCancelled) return;

                const poets = [...ganjoorPoets, ...customPoets, ...modernPoets]
                    .filter((poet) => poet.published)
                    .sort((a, b) => getPoetDisplayName(a).localeCompare(getPoetDisplayName(b), 'fa'));
                setAvailablePoets(poets);

                loadedPoetsRef.current = true;
            } catch (err) {
                if (!isCancelled) {
                    logger.error('Failed to load feed poets:', err);
                }
            }
        };

        loadPoets();

        return () => {
            isCancelled = true;
        };
    }, [areSettingsHydrated, currentPoem]);

    const fetchRandomPoemFromPreferredPoets = useCallback(async () => {
        const selectedKeys = settings.preferredPoetKeys;
        const sourceCount = selectedKeys.length + lovedCollections.length;

        if (sourceCount === 0) {
            throw new Error('No preferred poets or books');
        }

        // Every preferred poet and every loved book is one equal draw.
        const pick = Math.floor(Math.random() * sourceCount);
        if (pick >= selectedKeys.length) {
            return fetchRandomPoemFromCollection(lovedCollections[pick - selectedKeys.length]);
        }

        const selectedKey = selectedKeys[pick];
        const poet = parsePreferredPoetKey(selectedKey);

        if (!poet) {
            throw new Error('Invalid preferred poet selection');
        }

        if (poet.source === 'custom') {
            if (!isValidPoetSlug(poet.slug)) {
                throw new Error(`Unsupported custom poet: ${poet.slug}`);
            }
            return customApi.getRandomPoem(poet.slug);
        }

        if (poet.source === 'echolalia') {
            return echolaliaApi.getRandomPoemByPoetSlug(poet.slug);
        }

        const poetId = getIndexedGanjoorPoetId(poet.slug)
            ?? (await ganjoorApi.getPoetBySlug(poet.slug)).id;
        return fetchRandomPoemByPoetId(poetId);
    }, [settings.preferredPoetKeys, lovedCollections]);

    // «همه»: the open feed across every poet, with some poems similar to the saved favorites.
    const fetchRandomPoemFromAll = useCallback(async () => {
        if (Math.random() < SIMILAR_POEM_SHARE) {
            try {
                const similarPoem = await fetchSimilarPoem();
                if (similarPoem) {
                    return similarPoem;
                }
            } catch (error) {
                logger.error('Failed to fetch similar poem:', error);
            }
        }

        return fetchRandomGanjoorPoem();
    }, []);

    const fetchRandomPoemFromPreferredPoet = isPreferredMode
        ? fetchRandomPoemFromPreferredPoets
        : fetchRandomPoemFromAll;

    const fetchPoemBatch = useCallback(async (count: number) => {
        const fetchedPoems: Poem[] = [];

        for (let i = 0; i < count; i += POEM_FETCH_CONCURRENCY) {
            const batchSize = Math.min(POEM_FETCH_CONCURRENCY, count - i);
            const batchResults = await Promise.allSettled(
                Array.from({ length: batchSize }, () => fetchRandomPoemFromPreferredPoet()),
            );

            batchResults.forEach((result) => {
                if (result.status === 'fulfilled') {
                    fetchedPoems.push(result.value);
                } else {
                    logger.error('Error fetching feed poem:', result.reason);
                }
            });
        }

        return fetchedPoems;
    }, [fetchRandomPoemFromPreferredPoet]);

    const appendPoems = useCallback((newPoems: Poem[], version: number) => {
        if (newPoems.length === 0 || feedVersionRef.current !== version) {
            return;
        }

        setPoems((prevPoems) => {
            const existingIds = new Set(prevPoems.map((poem) => poem.id));
            const uniquePoems = newPoems.filter((poem) => !existingIds.has(poem.id));
            return uniquePoems.length > 0 ? [...prevPoems, ...uniquePoems] : prevPoems;
        });
    }, []);

    const fetchMorePoems = useCallback(async () => {
        if (fetchMorePromiseRef.current) {
            return fetchMorePromiseRef.current;
        }

        const version = feedVersionRef.current;
        const fetchPromise = (async () => {
            try {
                setIsFetchingMore(true);
                const fetchedPoems = await fetchPoemBatch(BATCH_SIZE);

                if (feedVersionRef.current !== version) {
                    return [];
                }

                const existingIds = new Set(poemsRef.current.map((poem) => poem.id));
                const uniquePoems = fetchedPoems.filter((poem) => !existingIds.has(poem.id));
                appendPoems(uniquePoems, version);
                return uniquePoems;
            } catch (err) {
                logger.error('Failed to fetch more poems:', err);
                return [];
            } finally {
                if (feedVersionRef.current === version) {
                    setIsFetchingMore(false);
                }
                fetchMorePromiseRef.current = null;
            }
        })();

        fetchMorePromiseRef.current = fetchPromise;
        return fetchPromise;
    }, [appendPoems, fetchPoemBatch]);

    const fetchInitialPoems = useCallback(async () => {
        const version = feedVersionRef.current + 1;
        feedVersionRef.current = version;
        fetchMorePromiseRef.current = null;
        pendingNavigationIndexRef.current = null;
        setError(null);
        setCurrentPoemIndex(0);

        try {
            setLoading(true);
            const firstPoem = await fetchRandomPoemFromPreferredPoet();

            if (feedVersionRef.current !== version) {
                return;
            }

            setPoems([firstPoem]);
            setCurrentPoemIndex(0);
            setLoading(false);

            fetchPoemBatch(INITIAL_POEMS_COUNT - 1)
                .then((remainingPoems) => {
                    appendPoems(remainingPoems, version);
                })
                .catch((err) => {
                    logger.error('Failed to fetch remaining initial poems:', err);
                });
        } catch (err) {
            if (feedVersionRef.current === version) {
                logger.error('Failed to fetch initial poem:', err);
                setError(
                    isPreferredMode
                        ? 'شعری از شاعران مورد علاقه بارگیری نشد. لطفاً دوباره تلاش کنید.'
                        : 'متأسفانه در بارگیری شعرها مشکلی پیش آمد. لطفاً دوباره تلاش کنید.',
                );
                setLoading(false);
            }
        }
    }, [appendPoems, fetchPoemBatch, fetchRandomPoemFromPreferredPoet, isPreferredMode]);

    useEffect(() => {
        if (!areSettingsHydrated) {
            return;
        }

        const previousSignature = hydratedFeedSignatureRef.current;
        hydratedFeedSignatureRef.current = feedSignature;
        const feedChanged =
            previousSignature !== null &&
            previousSignature !== feedSignature;
        const cachedInterestMismatch =
            previousSignature === null &&
            cachedInterestKeyRef.current !== feedSignature;

        cachedInterestKeyRef.current = feedSignature;

        if (isPreferredEmpty) {
            // Nothing to fetch; the empty state links to /poets.
            feedVersionRef.current += 1;
            fetchMorePromiseRef.current = null;
            setError(null);
            setLoading(false);
            return;
        }

        if (poems.length > 0 && !feedChanged && !cachedInterestMismatch) {
            setLoading(false);
            return;
        }

        fetchInitialPoems();
    }, [
        areSettingsHydrated,
        feedSignature,
        fetchInitialPoems,
        isPreferredEmpty,
        poems.length,
    ]);

    useEffect(() => {
        const shouldFetchMore =
            !loading &&
            !isPreferredEmpty &&
            currentPoemIndex >= poems.length - PREFETCH_THRESHOLD &&
            poems.length > 0 &&
            !isFetchingMore;

        if (shouldFetchMore) {
            fetchMorePoems();
        }
    }, [
        currentPoemIndex,
        poems.length,
        loading,
        isFetchingMore,
        isPreferredEmpty,
        fetchMorePoems,
    ]);

    const handleSaveFeedPoets = (keys: string[]) => {
        setPreferredPoetKeys(keys);
        if (keys.length > 0) {
            handleChangeFeedMode('preferred');
        }
        setIsFeedDialogOpen(false);
        if (shouldClearFeedQuery) {
            clearFeedQuery();
        }
    };

    // Keep the poem on screen but drop the queued poems of the old mode, so the
    // next pull always lands on a poem from the newly selected mode.
    function handleChangeFeedMode(mode: FeedMode) {
        if (mode === feedMode) {
            return;
        }
        const visiblePoem = poemsRef.current[currentPoemIndexRef.current];
        feedVersionRef.current += 1;
        fetchMorePromiseRef.current = null;
        pendingNavigationIndexRef.current = null;
        setIsFetchingMore(false);
        setPoems(visiblePoem ? [visiblePoem] : []);
        setCurrentPoemIndex(0);
        setFeedMode(mode);
    }

    const handleNext = useCallback(() => {
        const nextIndex = currentPoemIndexRef.current + 1;

        if (nextIndex < poemsRef.current.length) {
            setCurrentPoemIndex(nextIndex);
            return;
        }

        pendingNavigationIndexRef.current = nextIndex;
        fetchMorePoems().then((newPoems) => {
            if (newPoems.length === 0 && pendingNavigationIndexRef.current === nextIndex) {
                pendingNavigationIndexRef.current = null;
            }
        });
    }, [fetchMorePoems]);

    const handlePrevious = useCallback(() => {
        setCurrentPoemIndex((prevIndex) => Math.max(prevIndex - 1, 0));
    }, []);

    // Rendered above the title so it scrolls away with it (r5 title behaviour).
    const feedModeSwitch = (
        <FeedModeSwitch
            mode={feedMode}
            onChange={(mode) => handleChangeFeedMode(mode)}
            isLoading={loading && Boolean(currentPoem)}
        />
    );

    if (isPreferredEmpty && areSettingsHydrated) {
        return (
            <FeedModeEmpty
                switcher={feedModeSwitch}
                icon={<FaRegStar />}
                title="هنوز شاعر یا کتاب مورد علاقه‌ای ندارید"
                description="شاعری را به علاقه‌مندی‌ها بیفزایید یا کتابی را دوست بدارید تا این فید فقط از شعرهای آن‌ها پر شود. فید «همه» همچنان از همهٔ شاعران است."
                actions={(
                    <>
                        <Link href="/poets" className={buttonVariants({ size: 'lg' })}>
                            <FaRegStar aria-hidden="true" />
                            دیدن شاعران
                        </Link>
                        <button
                            type="button"
                            className={buttonVariants({ variant: 'ghost', size: 'lg' })}
                            onClick={() => handleChangeFeedMode('all')}
                        >
                            بازگشت به همه
                        </button>
                    </>
                )}
            />
        );
    }

    if (error && !currentPoem && isPreferredMode) {
        return (
            <FeedModeEmpty
                switcher={feedModeSwitch}
                icon={<FaRegStar />}
                title="فید علاقه‌مندی‌ها بارگیری نشد"
                description={error}
                actions={(
                    <>
                        <button
                            type="button"
                            className={buttonVariants({ size: 'lg' })}
                            onClick={fetchInitialPoems}
                        >
                            تلاش دوباره
                        </button>
                        <button
                            type="button"
                            className={buttonVariants({ variant: 'ghost', size: 'lg' })}
                            onClick={() => handleChangeFeedMode('all')}
                        >
                            بازگشت به همه
                        </button>
                    </>
                )}
            />
        );
    }

    if (!currentPoem && !error) {
        return <LoadingScreen />;
    }

    if (error && !currentPoem) {
        return <ErrorScreen message={error} onRetry={fetchInitialPoems} />;
    }

    return (
        <main className="h-screen overflow-hidden">
            {isFeedDialogOpen && (
                <FeedPoetDialog
                    poets={availablePoets}
                    selectedKeys={settings.preferredPoetKeys}
                    onSave={handleSaveFeedPoets}
                    onClose={() => {
                        setIsFeedDialogOpen(false);
                        if (shouldClearFeedQuery) {
                            clearFeedQuery();
                        }
                    }}
                />
            )}
            {currentPoem && (
                <PoemFeedPager
                    poem={currentPoem}
                    nextPoem={nextPoem}
                    isFirst={currentPoemIndex === 0}
                    isPreparingNextPoem={isFetchingMore && !nextPoem}
                    onNext={handleNext}
                    onPrevious={handlePrevious}
                    onOpenFeed={() => setIsFeedDialogOpen(true)}
                    titleEyebrow={<div className="home-feed-eyebrow">{feedModeSwitch}</div>}
                />
            )}
            {/* Floating chip of followed people's unseen fragments; shows on every poem of the feed. */}
            {currentPoem && <FollowingStoriesChip />}
        </main>
    );
}
