import { Century, Poet } from '@/types/poet';
import ganjoorApi from '@/api/GanjoorApi';
import { getCustomPoetsFromDisk } from '@/lib/customPoetsStore';
import { categoriesToPoets } from '@/api/EcholaliaApi';
import { getCategories as getEcholaliaCategories } from '@/lib/echolaliaStore';
import PoetsContent from '@/components/PoetsContent';
import { logger } from '@/utils/logger';
import { getStaticGanjoorCenturies, getStaticPoetsBySource } from '@/data/static-poets';

export const dynamic = 'force-dynamic';

async function getCenturies(): Promise<Century[]> {
    try {
        const centuries = await ganjoorApi.getCenturies();
        return centuries.length > 0 ? centuries : getStaticGanjoorCenturies();
    } catch (error) {
        logger.error("Error fetching centuries:", error);
        return getStaticGanjoorCenturies();
    }
}

async function getCustomPoets(): Promise<Poet[]> {
    try {
        logger.log("Fetching custom poets...");
        const poets = await getCustomPoetsFromDisk();
        logger.log(`Found ${poets.length} custom poets`);
        return poets;
    } catch (error) {
        logger.error("Error fetching custom poets:", error);
        return [];
    }
}

async function getModernPoets(): Promise<Poet[]> {
    try {
        logger.log("Fetching Echolalia poets...");
        // Server-side: read the local Echolalia mirror directly rather than fetching our own API route.
        const [root] = await getEcholaliaCategories({ slug: 'sher' });
        const poets = root ? categoriesToPoets(await getEcholaliaCategories(), root.id) : [];
        logger.log(`Found ${poets.length} Echolalia poets`);
        return poets.length > 0 ? poets : getStaticPoetsBySource('echolalia');
    } catch (error) {
        logger.error("Error fetching Echolalia poets:", error);
        return getStaticPoetsBySource('echolalia');
    }
}

export default async function PoetsPage() {
    const [centuries, customPoets, modernPoets] = await Promise.all([
        getCenturies(),
        getCustomPoets(),
        getModernPoets()
    ]);

    logger.log(`Rendering poets page with ${centuries.length} centuries, ${customPoets.length} custom poets and ${modernPoets.length} modern poets`);

    return (
        <PoetsContent centuries={centuries} customPoets={customPoets} modernPoets={modernPoets} />
    );
} 
