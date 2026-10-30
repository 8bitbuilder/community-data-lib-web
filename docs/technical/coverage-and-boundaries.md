# Coverage, boundaries and the county vocabulary

How the site knows which places a dataset describes, and how `/maps` draws that.

## Coverage model

Every dataset records the places it covers, separately from how finely its rows are broken down
(granularity).

| Field | Meaning | Example |
|---|---|---|
| `coverage` | Which places the data is about | national CHR file: `nation`; TRI Tennessee: `state 47`; Knox County Schools: `county 47093` |
| `geographic_granularity` | What one row describes | `nation`, `state`, `county`, `zip` or `point` |

- **Coverage is FIPS codes only.** It is a list of `{level: nation}`, `{level: state, fips: "47"}` or
  `{level: county, fips: "47093"}`. There is no geometry intersection.
- **Expansion:** `nation` covers every county, `state` covers every county in that state, and
  `county` covers itself.
- **Not used:** `geographic_coverage.available_levels` (written by a heuristic in the backend) is
  not imported or used anywhere.
- **The `where` field** is free text for people to read. Keep it consistent with `coverage`.

### Pipeline (the backend is the source of truth)

```
backend data/sources/<id>.yml   coverage: [...]
  -> import_sources_to_sqlite.py   table source_coverage(source_id, level, geoid)
  -> export_catalog.py             data/exports/catalog.json  coverage: [{level, geoid}]
  -> web scripts/sync-catalog-from-backend.mjs   frontmatter  coverage: [{level, geoid}]
  -> src/content.config.ts (Zod)   level: nation|state|county, geoid: US | 2 digits | 5 digits
```

New coverage goes into the backend YAML, never into web frontmatter alone.

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
- **Options:**
  - `--from <dir>` reads zips downloaded by hand, when census.gov can't be reached:
    - https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_20m.zip
    - https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_20m.zip
  - `--backend ../backend` also copies the vocabulary to the backend repo.

To move to a newer vintage, check that the `GENZ<year>` folder exists, bump `VINTAGE`, re-run
with `--backend ../backend`, and commit both repos.

## County vocabulary

The same county file also produces `src/data/geo-vocabulary.json`. It lists every state
(`geoid`, `name`, `usps`) and every county (`geoid`, `name`, `state`): 51 and 3,144 in 2025. It
is the site's list of valid FIPS codes.

- **Connecticut:** from the 2022 vintage on, Connecticut uses 9 planning regions (`09110`…`09190`),
  not its 8 old counties (`09001`…). Old codes fail the checks below.
- **Checks:**

  | Check | What it does | Where it runs |
  |---|---|---|
  | `npm run check:geo` (`scripts/check-geo-vocabulary.mjs`) | Fails if a catalog entry's coverage or a community file's `county_fips` is not in the vocabulary | `prebuild`, after `sync:catalog` |
  | `test_coverage_vocabulary.py` | Checks YAML coverage against the copy in `data/reference/geo-vocabulary.json` | backend pytest |
  | `county-names.json` | Names counties for the Data Preview county picker | Built to `/geo/county-names.json` |

## The /maps page

- **Logic:** `src/lib/data/coverageMap.ts` (pure, tested in `tests/coverageMap.test.ts`) expands
  coverage to counties, counts datasets per county, sorts a county's datasets (local first) and
  builds labels: "National", "Statewide (TN)", "Knox County, TN".
- **Page:** `src/pages/maps.astro` builds its county index from the vocabulary at build time. In
  the browser it draws counties with `topojson-client` `feature()` and state lines with `mesh()`,
  using Leaflet from unpkg.
- **Two views:**
  - datasets per county (shaded)
  - one dataset's coverage (with a note for national datasets)
- **Interaction:**
  - hovering shows the county name, state and dataset count
  - clicking a county (or picking one from the selects) lists its datasets as HTML links
- **Unmapped datasets:** datasets without coverage are listed under "Not mapped".
