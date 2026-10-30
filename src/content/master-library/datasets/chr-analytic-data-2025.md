---
title: "County Health Rankings 2025 Analytic Data (all U.S. counties)"
description: "County-level health indicators for every U.S. county, including premature death, chronic disease and mental health measures, health behaviors, access to care, and social and economic factors, as published in the 2025 County Health Rankings."
author: "County Health Rankings & Roadmaps"
sourceId: "chr-analytic-data-2025"
category: "dataset"
syncedFromBackend: true
tags:
  - "Business & Economy"
  - "Health & Social Services"
  - "Higher Education"
  - "Population Data"
  - "Transportation"
dataThemes:
  - "Business & Economy"
  - "Health & Social Services"
  - "Higher Education"
  - "Population Data"
  - "Transportation"
pedagogicalTags:
  - "data-literacy"
  - "social-justice"
  - "policy-analysis"
  - "civic-education"
  - "has categorical variable"
  - "meets minimum sample size"
  - "two groups present"
  - "multiple groups present"
  - "good for one proportion z test"
  - "large enough for clt"
  - "large dataset"
  - "single digit values"
sensitive: false
studentSuitability: "unreviewed"
granularity: "county"
coverage:
  - { level: "nation", geoid: "US" }
url: "https://www.countyhealthrankings.org/health-data/methodology-and-sources/data-documentation"
featured: false
difficulty: "advanced"
language: "English"
---

County Health Rankings & Roadmaps publishes a yearly set of health measures for nearly every county in the United States. This is the 2025 national analytic file: one row per county, with state and national rows for comparison.

## What's Included

- **Health outcomes**: Premature death, poor physical and mental health days, low birthweight
- **Health behaviors**: Adult smoking, obesity, physical inactivity, excessive drinking
- **Clinical care**: Uninsured rates, primary care and mental health provider ratios, preventable hospital stays
- **Social & economic factors**: High school completion, unemployment, income inequality, child poverty
- **Physical environment**: Air pollution, housing problems, access to parks and healthy food

## Using the Data

The first data row holds variable codes rather than values; skip it when loading the file. Filter on `State FIPS Code` and `County FIPS Code` to find a county: Knox County, Tennessee is state `47`, county `093`.

## Community Use

- Identify the leading preventable causes of premature death in your county.
- Compare your county with neighboring counties and the state average.
- Use social and economic measures to target community health work.

## Classroom Use

- **Health disparities**: How do outcomes differ between counties with different income levels?
- **Policy analysis**: Which measures move together across counties, and which don't?
- **Data visualization**: Build a dashboard comparing one county's health measures with its state.
