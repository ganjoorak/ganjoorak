const GANJOOR_API_BASE_URL =
    process.env.GANJOOR_API_BASE_URL ||
    process.env.NEXT_PUBLIC_GANJOOR_API_BASE_URL ||
    'https://api.ganjoor.net';

const ganjoorApiUrl = new URL(GANJOOR_API_BASE_URL);
const isDesktopBuild = process.env.DESKTOP_BUILD === '1';

const isVercel = Boolean(process.env.VERCEL);

// Versions the service worker: each deploy registers a new /sw.js?v=… with its
// own cache, and activation drops the previous deploy's cache.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

// Go accounts service (backend/). Proxied same-origin so the session cookie
// stays first-party. Rewrites are resolved at `next build`, so set this at
// build time, not only when the server starts.
const ACCOUNTS_API_URL = (process.env.ACCOUNTS_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');

// Echolalia poets whose poems now live in our own collection (public/poems): their old Echolalia
// pages redirect there. Post ids map to the local poem ids they were merged into.
const MERGED_ECHOLALIA_POETS = [
    { from: 'nosrat-rahmani', to: 'rahmani', posts: {
        118: 11,
        163: 12,
        245: 13,
        915: 14,
        940: 15,
        945: 16,
        1289: 17,
        1290: 5,
        1388: 18,
        3121: 19,
        7514: 20,
        9925: 21,
        10507: 3,
        10663: 22,
        11033: 23
    } },
    { from: 'forough-farrokhzad', to: 'farrokhzad', posts: {} },
];

const mergedPoetRedirects = () =>
    MERGED_ECHOLALIA_POETS.flatMap(({ from, to, posts }) =>
        ['', '/echolalia'].flatMap((prefix) => [
            ...Object.entries(posts).map(([postId, poemId]) => ({
                source: `${prefix}/${from}/${postId}`,
                destination: `/${to}/${poemId}`,
                permanent: true,
            })),
            { source: `${prefix}/${from}/:id*`, destination: `/${to}`, permanent: true },
        ]),
    );

/** @type {import('next').NextConfig} */
const nextConfig = {

    reactStrictMode: true,
    env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
    // The Echolalia mirror is read with fs at runtime, so tell file tracing to ship it.
    outputFileTracingIncludes: {
        '/api/echolalia/**': ['./data/echolalia/**'],
        '/poets': ['./data/echolalia/**', './public/poems/**'],
        // The accounts service reads quote and moshaere text from here (POEMS_API_URL).
        '/api/poem-lines': ['./data/echolalia/**', './public/poems/**'],
    },
    ...(isVercel ? {} : { output: 'standalone' }),

    async redirects() {
        return mergedPoetRedirects();
    },

    async rewrites() {
        const ganjoorApiBaseUrl = GANJOOR_API_BASE_URL.replace(/\/+$/, '');

        return [
            // Shareable profiles live at /@username. A segment starting with @
            // is parallel-route syntax in the App Router, so the page is /u/[username].
            // afterFiles rewrites run before dynamic routes, so [poet] never sees it.
            {
                source: '/@:username',
                destination: '/u/:username',
            },
            {
                source: '/api/account/:path*',
                destination: `${ACCOUNTS_API_URL}/api/account/:path*`,
            },
            {
                source: '/api/ganjoor/search/semantic',
                destination: 'https://ganjgah.ir/api/ganjoor/search/semantic',
            },
            // No /api/ganjoor/:path* rewrite on purpose: an external afterFiles rewrite beats the
            // dynamic route src/app/api/ganjoor/[...path], which holds the server-side cache.
            {
                source: '/api/audio/verses/:path*',
                destination: `${ganjoorApiBaseUrl}/api/audio/verses/:path*`,
            },
        ];
    },

    images: {
        // Used by the desktop app when it embeds a standalone Next build.
        unoptimized: isDesktopBuild,
        remotePatterns: [
            {
                protocol: ganjoorApiUrl.protocol.replace(':', ''),
                hostname: ganjoorApiUrl.hostname,
                port: ganjoorApiUrl.port,
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'api.ganjoor.net',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'ganjgah.ir',
                port: '',
                pathname: '/**',
            },
        ],
        minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
        formats: ['image/webp'],
        deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
        imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    },
};

module.exports = nextConfig;
