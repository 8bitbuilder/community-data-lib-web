import { getSourceTable } from "./csvCache.mjs";

const GEO_COLUMNS = {
  state: ["STATE", "STATEFP", "STATE_CODE", "ST"],
  stateName: ["STNAME", "STATE_NAME", "STATENAME"],
  county: ["COUNTY", "COUNTYFP", "COUNTY_CODE"],
  countyName: ["CTYNAME", "COUNTY_NAME", "COUNTYNAME"],
};

function findColumn(headers, candidates) {
  const upper = headers.map((h) => h.toUpperCase());
  for (const candidate of candidates) {
    const idx = upper.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] ?? "";
  });
  return obj;
}

function parseNumeric(value) {
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function selectPreviewColumns(source, headers, overrideColumns) {
  if (overrideColumns?.length) {
    return overrideColumns.filter((c) => headers.includes(c));
  }

  const variables = source.variables ?? [];
  const selected = variables.filter((v) => headers.includes(v));
  if (selected.length > 0) return selected;

  return headers;
}

function matchesFilter(rowObj, col, filterValue) {
  if (!col || !filterValue) return true;
  const cell = String(rowObj[col] ?? "").trim();
  const target = String(filterValue).trim();
  if (cell === target) return true;
  if (cell.toLowerCase() === target.toLowerCase()) return true;
  if (cell.padStart(target.length, "0") === target.padStart(cell.length, "0")) return true;
  return false;
}

function filterRows(headers, rows, { state, county }) {
  const stateCol = findColumn(headers, GEO_COLUMNS.state);
  const stateNameCol = findColumn(headers, GEO_COLUMNS.stateName);
  const countyCol = findColumn(headers, GEO_COLUMNS.county);
  const countyNameCol = findColumn(headers, GEO_COLUMNS.countyName);

  return rows.filter((row) => {
    const obj = rowToObject(headers, row);
    if (state) {
      const stateMatch =
        matchesFilter(obj, stateCol, state) || matchesFilter(obj, stateNameCol, state);
      if (!stateMatch) return false;
    }
    if (county) {
      const countyMatch =
        matchesFilter(obj, countyCol, county) || matchesFilter(obj, countyNameCol, county);
      if (!countyMatch) return false;
    }
    return true;
  });
}

function defaultFocalVariable(source, headers) {
  const report = source.variable_report ?? [];
  const numeric = report.find(
    (v) => (v.type === "integer" || v.type === "float") && headers.includes(v.name),
  );
  if (numeric) return numeric.name;

  const preferred = ["POPESTIMATE2025", "POPESTIMATE2024", "VALUE", "TOTAL"];
  for (const name of preferred) {
    if (headers.includes(name)) return name;
  }

  for (const name of source.variables ?? []) {
    if (headers.includes(name)) return name;
  }

  return headers[headers.length - 1] ?? null;
}

export function getAvailableFilters(headers, source) {
  const hasState =
    Boolean(findColumn(headers, GEO_COLUMNS.state)) ||
    Boolean(findColumn(headers, GEO_COLUMNS.stateName));
  const hasCounty =
    Boolean(findColumn(headers, GEO_COLUMNS.county)) ||
    Boolean(findColumn(headers, GEO_COLUMNS.countyName));

  return {
    state: source.filters?.state ?? hasState,
    county: source.filters?.county ?? hasCounty,
    zipcode: source.filters?.zipcode ?? false,
    year: source.filters?.year ?? false,
  };
}

export async function buildPreview(source, options = {}) {
  const { state, county, limit = 25, offset = 0, columns: columnsOverride } = options;
  const { headers, rows } = await getSourceTable(source);

  const filtered = filterRows(headers, rows, { state, county });
  const columns = selectPreviewColumns(
    source,
    headers,
    columnsOverride ? columnsOverride.split(",").map((c) => c.trim()) : null,
  );

  const slice = filtered.slice(offset, offset + limit);
  const previewRows = slice.map((row) => {
    const obj = rowToObject(headers, row);
    return columns.map((col) => obj[col] ?? "");
  });

  return {
    id: source.id,
    columns,
    rows: previewRows,
    total: filtered.length,
    filters: { state: state ?? null, county: county ?? null },
    availableFilters: getAvailableFilters(headers, source),
  };
}

const TEMPORAL_COLUMNS = ["YEAR", "DATE", "PERIOD", "TIMEPERIOD_NAME"];

export async function buildChart(source, options = {}) {
  const { variable, state, county, limit = 50, xVariable, plotType = "bar" } = options;
  const { headers, rows } = await getSourceTable(source);

  const focalVariable = variable || defaultFocalVariable(source, headers);
  if (!focalVariable || !headers.includes(focalVariable)) {
    throw new Error(`Focal variable not found: ${focalVariable ?? "none"}`);
  }

  const filtered = filterRows(headers, rows, { state, county });

  if (plotType === "scatter") {
    if (!xVariable || !headers.includes(xVariable)) {
      throw new Error(`X variable not found: ${xVariable ?? "none"}`);
    }
    const points = [];
    for (const row of filtered) {
      const obj = rowToObject(headers, row);
      const x = parseNumeric(obj[xVariable]);
      const y = parseNumeric(obj[focalVariable]);
      if (x === null || y === null) continue;
      points.push({ x, y });
      if (points.length >= limit) break;
    }
    return {
      variable: focalVariable,
      label: focalVariable.replace(/_/g, " "),
      xVariable,
      xLabel: xVariable.replace(/_/g, " "),
      points,
    };
  }

  // Determine X-axis column
  let xCol;
  if (xVariable && headers.includes(xVariable)) {
    xCol = xVariable;
  } else {
    // Auto-detect: try temporal columns first, then fall back to headers[0]
    xCol = findColumn(headers, TEMPORAL_COLUMNS) || headers[0];
  }

  // Group rows by X value, accumulating Y values for averaging
  const xGroups = new Map(); // xKey -> { sum, count }
  for (const row of filtered) {
    const obj = rowToObject(headers, row);
    const value = parseNumeric(obj[focalVariable]);
    if (value === null) continue;
    const xKey = String(obj[xCol] ?? "").trim();
    if (!xGroups.has(xKey)) {
      xGroups.set(xKey, { sum: 0, count: 0 });
    }
    const entry = xGroups.get(xKey);
    entry.sum += value;
    entry.count += 1;
  }

  // Build series from groups
  let series = [];
  for (const [xKey, { sum, count }] of xGroups) {
    series.push({ label: xKey, value: sum / count });
  }

  // Sort: numeric if all X labels are numeric strings, else lexicographic
  const allNumeric = series.every((p) => Number.isFinite(Number(p.label)));
  if (allNumeric) {
    series.sort((a, b) => Number(a.label) - Number(b.label));
  } else {
    series.sort((a, b) => a.label.localeCompare(b.label));
  }

  // Apply limit after sorting
  if (series.length > limit) series = series.slice(0, limit);

  return {
    variable: focalVariable,
    label: focalVariable.replace(/_/g, " "),
    xVariable: xCol,
    xLabel: xCol.replace(/_/g, " "),
    series,
  };
}

export async function listFilterOptions(source, filterType, parentFilter = {}) {
  const { headers, rows } = await getSourceTable(source);
  const { state } = parentFilter;

  if (filterType === "state") {
    const codeCol = findColumn(headers, GEO_COLUMNS.state);
    const nameCol = findColumn(headers, GEO_COLUMNS.stateName);
    const seen = new Map();
    for (const row of rows) {
      const obj = rowToObject(headers, row);
      const code = codeCol ? String(obj[codeCol] ?? "").trim() : "";
      const name = nameCol ? String(obj[nameCol] ?? "").trim() : "";
      if (code && name) seen.set(code, name);
      else if (name) seen.set(name, name);
      else if (code) seen.set(code, code);
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  if (filterType === "county") {
    const stateCol = findColumn(headers, GEO_COLUMNS.state);
    const stateNameCol = findColumn(headers, GEO_COLUMNS.stateName);
    const codeCol = findColumn(headers, GEO_COLUMNS.county);
    const nameCol = findColumn(headers, GEO_COLUMNS.countyName);
    const seen = new Map();
    for (const row of rows) {
      const obj = rowToObject(headers, row);
      if (state) {
        const stateMatch =
          matchesFilter(obj, stateCol, state) || matchesFilter(obj, stateNameCol, state);
        if (!stateMatch) continue;
      }
      const code = codeCol ? String(obj[codeCol] ?? "").trim() : "";
      const name = nameCol ? String(obj[nameCol] ?? "").trim() : "";
      if (code && name) seen.set(code, name);
      else if (name) seen.set(name, name);
      else if (code) seen.set(code, code);
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return [];
}
