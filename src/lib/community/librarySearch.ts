// Search for the community library list page (/libraries). The page renders every
// library at build time and filters in the browser, so this stays dependency-free.

export interface LibrarySearchFields {
  name: string;
  slug?: string;
  place_name?: string;
  county?: string;
  state_code?: string;
  state_name?: string;
  county_fips?: string;
  description?: string;
}

/** Lowercase, drop accents and punctuation, and collapse whitespace. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The text a library is matched against: its name and every part of its location. */
export function librarySearchText(library: LibrarySearchFields): string {
  return normalizeSearchText(
    [
      library.name,
      library.place_name,
      library.county,
      library.state_code,
      library.state_name,
      library.county_fips,
      library.slug,
      library.description,
    ]
      .filter(Boolean)
      .join(' ')
  );
}

/**
 * True when every word of the query appears in the library's search text, so
 * "knox tn", "Knoxville" and "47093" all find Knox County. An empty query matches all.
 */
export function matchesLibraryQuery(searchText: string, query: string): boolean {
  const words = normalizeSearchText(query).split(' ').filter(Boolean);
  return words.every((word) => searchText.includes(word));
}
