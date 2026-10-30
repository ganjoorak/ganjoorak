import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/utils/logger';

export const dynamic = 'force-dynamic';

// The poems files are static (baked into the image / public/poems), so the parsed and serialized
// result is kept in memory and only re-read when the file's mtime changes.
// `?info=1` returns just the poet's identity, without the poems (307 KB for farrokhzad).
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface PoetBodies {
    mtimeMs: number;
    full: string;
    info: string;
}

const bodiesCache = new Map<string, PoetBodies>();

// Handle OPTIONS request for CORS preflight
export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

async function loadBodies(poetSlug: string): Promise<PoetBodies | null> {
    const filePath = path.join(process.cwd(), 'public', 'poems', `${poetSlug}.json`);
    let mtimeMs: number;
    try {
        mtimeMs = (await stat(filePath)).mtimeMs;
    } catch {
        return null;
    }

    const cached = bodiesCache.get(poetSlug);
    if (cached && cached.mtimeMs === mtimeMs) {
        return cached;
    }

    const data = JSON.parse(await readFile(filePath, 'utf8'));
    data.imageUrl = `/images/poets/${poetSlug}.jpeg`;
    const bodies: PoetBodies = {
        mtimeMs,
        full: JSON.stringify(data),
        info: JSON.stringify({ poet: data.poet, poetSlug: data.poetSlug, imageUrl: data.imageUrl }),
    };
    bodiesCache.set(poetSlug, bodies);
    return bodies;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    try {
        const { slug: poetSlug } = await params;

        if (!/^[a-z0-9-]+$/i.test(poetSlug)) {
            return NextResponse.json(
                { error: `Poet data not found for ${poetSlug}` },
                { status: 404, headers: corsHeaders }
            );
        }

        try {
            const bodies = await loadBodies(poetSlug);
            if (!bodies) {
                logger.log(`Local poet data not found for slug: ${poetSlug}`);
                return NextResponse.json(
                    { error: `Poet data not found for ${poetSlug}` },
                    { status: 404, headers: corsHeaders }
                );
            }

            const infoOnly = request.nextUrl.searchParams.get('info') === '1';
            return new NextResponse(infoOnly ? bodies.info : bodies.full, {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Cache-Control': CACHE_CONTROL,
                },
            });
        } catch (localError: any) {
            logger.error("Error fetching local poet data:", localError);
            return NextResponse.json(
                { error: "Error fetching local poet data", details: localError?.message || String(localError) },
                { status: 500, headers: corsHeaders }
            );
        }
    } catch (error: any) {
        logger.error(`Error getting poet data:`, error);
        return NextResponse.json(
            { error: "Internal server error", details: error?.message || String(error) },
            { status: 500, headers: corsHeaders }
        );
    }
}
