import type { ParsedFile } from "./csv";
import { normalizeCounty, parseCoordinate } from "./fields";

/**
 * Washington cities, towns, and census-designated places from the U.S. Census Bureau:
 * the Gazetteer gives each place's internal point, and the place-by-county file gives its
 * county. A place spanning more than one county gets no county, so a county filter never
 * excludes programs serving the other part of it.
 */

export const GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_place_53.txt";
export const PLACE_BY_COUNTY_URL =
  "https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/st53_wa_place_by_county2020.txt";

export interface PlaceRow {
  name: string;
  county: string | null;
  state: "WA";
  latitude: number;
  longitude: number;
}

/** "Aberdeen city" -> "Aberdeen"; "Aberdeen Gardens CDP" -> "Aberdeen Gardens". */
export function placeName(censusName: string): string {
  return censusName.replace(/\s+(city|town|CDP)$/i, "").trim();
}

export function joinCensusPlaces(files: { gazetteer: ParsedFile; placeByCounty: ParsedFile }): PlaceRow[] {
  const counties = new Map<string, Set<string>>();
  for (const { values } of files.placeByCounty.records) {
    const county = normalizeCounty(values.COUNTYNAME);
    if (!county) continue;
    const fp = values.PLACEFP.trim();
    if (!counties.has(fp)) counties.set(fp, new Set());
    counties.get(fp)!.add(county);
  }

  // Incorporated places win a name collision with a census-designated place.
  const byName = new Map<string, PlaceRow & { incorporated: boolean }>();
  for (const { values } of files.gazetteer.records) {
    if (values.USPS?.trim() !== "WA") continue;
    const latitude = parseCoordinate(values.INTPTLAT, "latitude");
    const longitude = parseCoordinate(values.INTPTLONG, "longitude");
    if (latitude === null || longitude === null) continue;
    const name = placeName(values.NAME);
    const placeCounties = counties.get(values.GEOID.trim().slice(2)) ?? new Set();
    const row = {
      name,
      county: placeCounties.size === 1 ? [...placeCounties][0] : null,
      state: "WA" as const,
      latitude,
      longitude,
      incorporated: !/\bCDP$/i.test(values.NAME),
    };
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (row.incorporated && !existing.incorporated)) byName.set(key, row);
  }

  return [...byName.values()].map(({ incorporated: _, ...row }) => row).sort((a, b) => a.name.localeCompare(b.name));
}
