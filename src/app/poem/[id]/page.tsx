'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PoemViewer from '@/components/PoemViewer';
import LoadingScreen from '@/components/LoadingScreen';
import ErrorScreen from '@/components/ErrorScreen';
import ganjoorApi from '@/api/GanjoorApi';
import type { Poem } from '@/types/poem';
import { logger } from '@/utils/logger';
import { fetchRandomGanjoorPoem } from '@/utils/poemIndex';

export default function PoemPage() {
    const params = useParams();
    const router = useRouter();
    const [poem, setPoem] = useState<Poem | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // The next (random) poem is fetched ahead so pull-to-next can show it and switch without a loading flash.
    const [upcoming, setUpcoming] = useState<Poem | null>(null);
    const upcomingForRef = useRef<number | null>(null);
    const poemRef = useRef<Poem | null>(null);
    poemRef.current = poem;

    useEffect(() => {
        const loadPoem = async () => {
            try {
                setLoading(true);
                const id = params?.id;

                if (!id) {
                    const randomPoem = await fetchRandomGanjoorPoem();
                    router.push(`/poem/${randomPoem.id}`);
                    return;
                }

                const poemId = parseInt(id as string);
                if (isNaN(poemId) || poemId < 1) {
                    const randomPoem = await fetchRandomGanjoorPoem();
                    router.push(`/poem/${randomPoem.id}`);
                    return;
                }

                if (poemRef.current?.id === poemId) {
                    // Already on screen (client-side switch from pull-to-next).
                    return;
                }

                try {
                    const loadedPoem = await ganjoorApi.getPoemById(poemId);
                    setPoem(loadedPoem);
                    setError(null);
                } catch (err) {
                    // If poem not found, redirect to a random poem
                    const randomPoem = await fetchRandomGanjoorPoem();
                    router.push(`/poem/${randomPoem.id}`);
                    return;
                }
            } catch (err) {
                logger.error('Error loading poem:', err);
                setError(err instanceof Error ? err.message : 'خطا در بارگیری شعر');
            } finally {
                setLoading(false);
            }
        };

        loadPoem();
    }, [params?.id, router]);

    const poemId = poem?.id ?? null;
    useEffect(() => {
        if (poemId === null || upcomingForRef.current === poemId) return;
        const forId = poemId;
        upcomingForRef.current = forId;
        setUpcoming(null);
        fetchRandomGanjoorPoem()
            .then((next) => {
                // Ignore a result that arrives after the reader already moved on.
                if (upcomingForRef.current === forId && next.id !== forId) setUpcoming(next);
            })
            .catch((err) => logger.error('Error preloading next poem:', err));
    }, [poemId]);

    const showPoem = (next: Poem) => {
        setPoem(next);
        setUpcoming(null);
        // Client-side switch: update the URL without remounting the page (no loading flash).
        window.history.pushState(null, '', `/poem/${next.id}`);
    };

    // `target` is the poem the pull sheet showed; it is used as-is so the landed poem always matches the peek.
    const handleNext = async (target?: Poem) => {
        try {
            const known = target ?? upcoming;
            if (known && known.id !== poem?.id) {
                showPoem(known);
                return;
            }
            showPoem(await fetchRandomGanjoorPoem());
        } catch (err) {
            logger.error('Error loading next poem:', err);
            setError(err instanceof Error ? err.message : 'خطا در بارگیری شعر بعدی');
        }
    };

    if (loading && !poem) {
        return <LoadingScreen />;
    }

    if (error) {
        return <ErrorScreen message={error} onRetry={() => handleNext()} />;
    }

    return poem ? (
        <main className="h-screen overflow-hidden">
            <PoemViewer
                poem={poem}
                onNext={handleNext}
                onPrevious={() => { }}
                isFirst={true}
                isLast={true}
                isModern={false}
                pullToNext
                nextPoemPeek={upcoming}
                isPreparingNext={!upcoming}
            />
        </main>
    ) : null;
}
