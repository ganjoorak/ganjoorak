import type { Poet } from "@/types/poet";
import type { GanjoorCategory, GanjoorGeoLocation, PoemGeoDateTag } from "@/types/ganjoor";

export function collectPoemIdsFromCategory(category: GanjoorCategory): number[] {
  const poemIds = (category.poems ?? []).map((poem) => poem.id).filter((id) => id > 0);
  const childIds = (category.children ?? []).flatMap((child) =>
    collectPoemIdsFromCategory(child),
  );
  return [...poemIds, ...childIds];
}

export function uniqueGeoLocations(
  tags: PoemGeoDateTag[],
  poet?: Poet,
): GanjoorGeoLocation[] {
  const locations = new Map<number, GanjoorGeoLocation>();

  tags.forEach((tag) => {
    if (tag.location?.id) {
      locations.set(tag.location.id, tag.location);
    }
  });

  const addPlace = (
    name: string | null,
    latitude: number | null,
    longitude: number | null,
    id: number,
  ) => {
    if (
      !name ||
      latitude === null ||
      longitude === null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }

    if (!locations.has(id)) {
      locations.set(id, {
        id,
        name,
        latitude,
        longitude,
        machineGenerated: false,
      });
    }
  };

  if (poet) {
    addPlace(
      poet.birthPlace,
      poet.birthPlaceLatitude,
      poet.birthPlaceLongitude,
      -1,
    );
    addPlace(
      poet.deathPlace,
      poet.deathPlaceLatitude,
      poet.deathPlaceLongitude,
      -2,
    );
  }

  return Array.from(locations.values());
}
