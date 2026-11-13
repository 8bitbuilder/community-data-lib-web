# Coverage, boundaries and the county vocabulary

How the site knows which places a dataset describes, and how `/maps` draws that.

## Coverage model

Every dataset records the places it covers, separately from how finely its rows are broken down
(granularity).

| Field | Meaning | Example |
|---|---|---|
| `coverage` | Which places the data is about | national CHR file: `nation`; TRI Tennessee: `state 47`; Knox County Schools: `county 47093`; data for a few Knox tracts: `tract 47093004600`; data for one ZIP area: `zip 37919` |
| `geographic_granularity` | What one row describes | `state`, `county`, `tract`, `zip` or `point` |

- **Local data only:** a dataset whose `filters` show no state, county or ZIP breakdown is out of
  scope (web#42). It stays in the backend's YAML and SQLite, but the catalog export and the dev API
  leave it out, and `sync:catalog` stops the build if one appears in `catalog.json`. A dataset with
  no `filters` also stops it.
  National *coverage* is fine (a county file for every U.S. county), and community catalogs and map
  counts use coverage as before.

- **Coverage is codes only.** It is a list of entries, one per place:

  | Level | YAML | Code |
  |---|---|---|
  | `nation` | `{level: nation}` | `US` |
  | `state` | `{level: state, fips: "47"}` | 2-digit state FIPS |
  | `county` | `{level: county, fips: "47093"}` | 5-digit county FIPS |
  | `tract` | `{level: tract, fips: "47093004600"}` | 11-digit census tract GEOID |
  | `zip` | `{level: zip, zcta: "37919"}` | 5-digit ZIP Code Tabulation Area (ZCTA) |

  There is no geometry intersection on the site. Tract and zip entries are matched to counties
  with codes and a Census crosswalk, below.
- **Tract or zip coverage is for data about only some places.** A file with every tract in the
  U.S. is `coverage: nation` with `geographic_granularity: tract`, like the NaNDA sources.
- **Expansion:** `nation` covers every county, `state` covers every county in that state, `county`
  covers itself, a `tract` covers the county it lies in, and a `zip` covers every county its ZCTA
  lies in.
- **Not used:** `geographic_coverage.available_levels` (written by a heuristic in the backend) is
  not imported or used anywhere.
- **The `where` field** is free text for people to read. Keep it consistent with `coverage`.

### ZIP codes are ZCTAs

`zip` coverage and `geographic_granularity: zip` mean Census **ZIP Code Tabulation Areas**, not
USPS ZIP codes.

- USPS ZIP codes are mail delivery routes. They have no official boundary, some are a single
  building or post office box, and USPS changes them often.
- ZCTAs are the Census Bureau's areas built from those routes, with fixed boundaries for each
  decennial census. Census and NaNDA data use them.
- The only USPS-to-county crosswalk (HUD's) needs an account and an API token.
- **To add USPS ZIP data:** convert each ZIP to its ZCTA first (most are the same 5 digits). A ZIP
  code with no ZCTA (a PO box or single-building ZIP) can't be added.

### Matching tracts and ZCTAs to counties (backend)

The backend's catalog export adds `counties` to each tract and zip entry, and the site matches
libraries on those counties. The site keeps no crosswalk of its own.

- **Tracts:** a tract's county is the first 5 digits of its GEOID. Connecticut tracts must use 2022
  or later codes, which start with a planning region (`09110`…), since the county vocabulary has
  the regions.
- **ZCTAs:** `backend data/reference/zcta-county.json` lists the counties each ZCTA lies in,
  largest land share first. `python pythonscripts/build_zcta_county.py` builds it from Census
  relationship files (public domain), and the output is committed:
  - [2020 ZCTA to 2020 county](https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt), national
  - [2022 Connecticut town to 2020 ZCTA](https://www2.census.gov/geo/docs/maps-data/data/rel2022/acs22_cousub22_zcta520_st09.txt),
    so Connecticut ZCTAs match planning regions, not the old counties
- **Crossing county lines:** a ZCTA counts toward every county that holds **at least 1%** of its
  land area (`MIN_LAND_SHARE`). Smaller overlaps are slivers from boundaries that don't line up.
  About 9,400 of the 33,642 ZCTAs cross a county line; ZCTA 37801 (Maryville, TN), for example,
  matches Blount and Monroe counties.
- **Left out:** ZCTAs only in Puerto Rico or the island areas, which the county vocabulary doesn't
  have. A ZCTA that isn't in the file stops the backend export.

Why a crosswalk and not a spatial join: the Census relationship file *is* the intersection of
ZCTA and county boundaries, made from the full-resolution TIGER/Line shapes. Intersecting the
generalized display shapes again would be less accurate and would add geopandas to the pipeline.

### Pipeline (the backend is the source of truth)

```
backend data/sources/<id>.yml   coverage: [...]
  -> import_sources_to_sqlite.py   table source_coverage(source_id, level, geoid)
  -> export_catalog.py             data/exports/catalog.json  coverage: [{level, geoid, counties?}]
                                   (counties for tract and zip, from data/reference/zcta-county.json)
  -> web scripts/sync-catalog-from-backend.mjs   frontmatter  coverage: [{level, geoid, counties?}]
  -> src/content.config.ts (Zod)   level: nation|state|county|tract|zip, a geoid of the right
                                   length for the level, and counties on tract and zip entries only
```

New coverage goes into the backend YAML, never into web frontmatter alone.

## Community library catalogs

`matchesCommunity()` in `src/lib/data/communityFilter.ts` decides which datasets a library shows,
from the library's county FIPS:

| Coverage | Shown in a library when |
|---|---|
| `nation` | the data is county level or finer (`geographic_granularity` county, tract, zip or point) |
| `state` | it is the library's state and the data is county level or finer |
| `county` | it is the library's county |
| `tract` | the tract is in the library's county |
| `zip` | the library's county is one of the ZCTA's `counties` (so a ZCTA that crosses county lines shows in each of those libraries) |

A dataset with several entries is shown if any of them matches. Cards for tract and ZIP data
carry a "By census tract" or "By ZIP code (ZCTA)" label.

## Boundary file

`npm run geo:boundaries` (`scripts/build-geo-boundaries.mjs`) builds the map's geometry. It is
run by hand, never in `prebuild`, so builds don't depend on census.gov. The output is committed.

- **Source:** U.S. Census Bureau cartographic boundary files: the generalized, display-oriented
  versions of TIGER/Line, for states and counties.
- **Vintage and resolution:** pinned in `VINTAGE` and `RESOLUTION` at the top of the script
  (currently 2025, 1:20,000,000).
- **Processing (mapshaper):**
  - reproject to WGS84
  - keep the 50 states and DC
  - shift the Aleutians west of −180°
  - write one TopoJSON file with `states` and `counties` objects (feature `id` = GEOID,
    properties `name` and `state`), quantization 100,000
  - no extra simplification
- **Output:** `public/geo/boundaries/us-2025-20m.topo.json` (807 KB, about 230 KB gzipped). The
  script fails above 2 MB. Provenance is in
  [public/geo/boundaries/README.md](../../public/geo/boundaries/README.md).
- **No tract or ZCTA shapes:** the national tract and ZCTA files are tens of megabytes even
  generalized, far over the 2 MB limit, so the map stays at county level (see "The /maps page").
- **Options:**
  - `--from <dir>` reads zips downloaded by hand, when census.gov can't be reached:
    - https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_20m.zip
    - https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_20m.zip
  - `--backend ../backend` also copies the vocabulary to the backend repo.

To move to a newer vintage, check that the `GENZ<year>` folder exists, bump `VINTAGE`, re-run
with `--backend ../backend`, and commit both repos. Then re-run `build_zcta_county.py` in the
backend, since it keeps only counties in the vocabulary.

## County vocabulary

The same county file also produces `src/data/geo-vocabulary.json`. It lists every state
(`geoid`, `name`, `usps`) and every county (`geoid`, `name`, `state`): 51 and 3,144 in 2025. It
is the site's list of valid FIPS codes.

- **Connecticut:** from the 2022 vintage on, Connecticut uses 9 planning regions (`09110`…`09190`),
  not its 8 old counties (`09001`…). Old codes fail the checks below, including in tract codes.
- **Checks:**

  | Check | What it does | Where it runs |
  |---|---|---|
  | `npm run check:geo` (`scripts/check-geo-vocabulary.mjs`) | Fails if a catalog entry's coverage or a community file's `county_fips` is not in the vocabulary. A tract or zip entry fails if its code has the wrong length, it has no `counties`, a tract's county isn't its first 5 digits, or a listed county is unknown | `prebuild`, after `sync:catalog` |
  | Communities loader | Fails the build for a library with an unknown county | `src/lib/community/communityStore.mjs` |
  | Librarian function | Refuses a county outside the vocabulary | Netlify Functions |
  | `test_coverage_vocabulary.py` | Checks YAML coverage against the copy in `data/reference/geo-vocabulary.json`, a tract by its county, and a ZCTA against `data/reference/zcta-county.json` | backend pytest |
  | `test_build_zcta_county.py` | Checks the 1% rule, Connecticut regions, and that every county in `zcta-county.json` is in the vocabulary | backend pytest |
  | `county-names.json` | Names counties for the Data Preview county picker | Built to `/geo/county-names.json` |

## The /maps page

- **Logic:** `src/lib/data/coverageMap.ts` (pure, tested in `tests/coverageMap.test.ts`) expands
  coverage to counties, counts datasets per county, sorts a county's datasets (most local first:
  tract and zip, then county, state, nation) and builds labels: "National", "Statewide (TN)",
  "Knox County, TN", "2 tracts in Knox County, TN", "ZIP 37801 (Blount County, TN; Monroe County, TN)".
- **Page:** `src/pages/maps.astro` builds its county index from the vocabulary at build time. In
  the browser it draws counties with `topojson-client` `feature()` and state lines with `mesh()`,
  using Leaflet from unpkg.
- **Two views:**
  - datasets per county (shaded)
  - one dataset's coverage (with a note for national datasets, and a note that tract and ZIP
    data covers only part of each shaded county)
- **Interaction:**
  - hovering shows the county name, state and dataset count
  - clicking a county (or picking one from the selects) lists its datasets as HTML links. Tract and
    ZIP data says how much of the county it covers ("2 tracts in this county", "ZIP 37754, which
    crosses into other counties"), and tract and ZIP-level datasets add "by census tract" or
    "by ZIP code (ZCTA)".
- **What each level shows:**

  | Coverage | Shaded counties | County panel label |
  |---|---|---|
  | `nation` | all | National |
  | `state` | every county in the state | Statewide (TN) |
  | `county` | that county | Knox County, TN |
  | `tract` | the county of each tract | 2 tracts in this county |
  | `zip` | every county each ZCTA lies in | ZIP 37919, or ZIP 37754, which crosses into other counties |

- **Unmapped datasets:** datasets without coverage are listed under "Not mapped".
