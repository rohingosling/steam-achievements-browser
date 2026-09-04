//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Central time-to-live policy for persistent shared Steam metadata and short-lived user-specific edge responses.
//   Keeping every retention value out of feature modules makes cache behavior auditable and allows later capacity
//   adjustments without route-level changes.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

const HOURS_IN_DAY      = 24;
const MINUTES_IN_HOUR   = 60;
const SECONDS_IN_MINUTE = 60;
const SECONDS_IN_HOUR   = MINUTES_IN_HOUR * SECONDS_IN_MINUTE;
const SECONDS_IN_DAY    = HOURS_IN_DAY * SECONDS_IN_HOUR;

export const EDGE_CACHE_TTL_SECONDS =
{
    selectedGameAchievements: 2 * SECONDS_IN_MINUTE,
    userLibrary:              5 * SECONDS_IN_MINUTE,
    userProfile:              10 * SECONDS_IN_MINUTE,
} as const;

export const SHARED_CACHE_TTL_SECONDS =
{
    achievementCapability: 30 * SECONDS_IN_DAY,
    achievementItemProgressSchema: 30 * SECONDS_IN_DAY,
    achievementSchema:     30 * SECONDS_IN_DAY,
    gameMetadata:          SECONDS_IN_DAY,
    globalRarity:          6 * SECONDS_IN_HOUR,
} as const;
