/**
 * /geo/county-names.json
 *
 * State and county names by FIPS code, for the Data Preview county picker.
 * Pre-rendered at build time from src/data/geo-vocabulary.json (Census 2025);
 * fetched only by previews of datasets that have county files.
 */
import type { APIRoute } from 'astro';
import vocabulary from '@data/geo-vocabulary.json';

export const GET: APIRoute = () => {
  const payload = {
    vintage: vocabulary.vintage,
    states: Object.fromEntries(vocabulary.states.map((s) => [s.geoid, s.name])),
    // [name, USPS state code]
    counties: Object.fromEntries(vocabulary.counties.map((c) => [c.geoid, [c.name, c.state]])),
  };
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
};
