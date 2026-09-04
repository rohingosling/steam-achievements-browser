//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Typed persistent-cache operations for shared achievement schemas and game capability results. Feature code uses
//   these normalized helpers without depending on Workers KV values or serialization details.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import {
    achievementCapabilityCacheKey,
    achievementItemProgressSchemaCacheKey,
    achievementSchemaCacheKey,
    globalRarityCacheKey,
} from './cache-keys';
import { SHARED_CACHE_TTL_SECONDS } from './cache-policy';
import { SharedCache } from './cache';
import type {
    AchievementCapabilitySummary,
    AchievementDefinition,
    AchievementItemProgressDefinition,
    AchievementItemProgressSchema,
    AchievementSchema,
    GlobalAchievementPercentage,
    GlobalAchievementRarity,
} from '../model/api';
import {
    getAchievementItemProgressSchema,
    getAchievementSchema,
    getGlobalAchievementRarity,
} from '../steam/achievements';

//---------------------------------------------------------------------------------------------------------------------
// Validation helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isJsonObject
//
// Description:
//
//   Determines whether the supplied value satisfies the JSON object contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the JSON object contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isJsonObject ( value: unknown ): value is Record<string, unknown>
{
    return typeof value === 'object' && value !== null && !Array.isArray ( value );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNullableString
//
// Description:
//
//   Determines whether the supplied value satisfies the nullable string contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the nullable string contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNullableString ( value: unknown ): value is string | null
{
    return value === null || typeof value === 'string';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isAchievementDefinition
//
// Description:
//
//   Determines whether the supplied value satisfies the achievement definition contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the achievement definition contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isAchievementDefinition ( value: unknown ): value is AchievementDefinition
{
    if ( !isJsonObject ( value ) )
    {
        return false;
    }

    return typeof value.apiName === 'string'
        && value.apiName.length > 0
        && isNullableString ( value.description )
        && isNullableString ( value.iconGrayUrl )
        && isNullableString ( value.iconUrl )
        && typeof value.name === 'string'
        && value.name.length > 0;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isAchievementItemProgressDefinition
//
// Description:
//
//   Determines whether the supplied value satisfies the achievement item progress definition contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the achievement item progress definition contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isAchievementItemProgressDefinition ( value: unknown ): value is AchievementItemProgressDefinition
{
    if ( !isJsonObject ( value ) )
    {
        return false;
    }

    return typeof value.apiName === 'string'
        && value.apiName.length > 0
        && typeof value.internalKey === 'number'
        && Number.isSafeInteger ( value.internalKey )
        && value.internalKey >= 0
        && typeof value.minimum === 'number'
        && Number.isFinite ( value.minimum )
        && typeof value.target === 'number'
        && Number.isFinite ( value.target )
        && value.target > value.minimum
        && value.target > 1;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isAchievementSchema
//
// Description:
//
//   Determines whether the supplied value satisfies the achievement schema contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the achievement schema contract.
//
//---------------------------------------------------------------------------------------------------------------------

export function isAchievementSchema ( value: unknown ): value is AchievementSchema
{
    return isJsonObject ( value )
        && Array.isArray ( value.achievements )
        && value.achievements.every ( isAchievementDefinition );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isAchievementItemProgressSchema
//
// Description:
//
//   Determines whether the supplied value satisfies the achievement item progress schema contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the achievement item progress schema contract.
//
//---------------------------------------------------------------------------------------------------------------------

export function isAchievementItemProgressSchema ( value: unknown ): value is AchievementItemProgressSchema
{
    return isJsonObject ( value )
        && Array.isArray ( value.achievements )
        && value.achievements.every ( isAchievementItemProgressDefinition );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isAchievementCapabilitySummary
//
// Description:
//
//   Determines whether the supplied value satisfies the achievement capability summary contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the achievement capability summary contract.
//
//---------------------------------------------------------------------------------------------------------------------

export function isAchievementCapabilitySummary ( value: unknown ): value is AchievementCapabilitySummary
{
    if ( !isJsonObject ( value ) )
    {
        return false;
    }

    return Number.isSafeInteger ( value.achievementCount )
        && ( value.achievementCount as number ) >= 0
        && typeof value.hasAchievements === 'boolean'
        && value.hasAchievements === ( ( value.achievementCount as number ) > 0 );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGlobalAchievementPercentage
//
// Description:
//
//   Determines whether the supplied value satisfies the global achievement percentage contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the global achievement percentage contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGlobalAchievementPercentage ( value: unknown ): value is GlobalAchievementPercentage
{
    if ( !isJsonObject ( value ) )
    {
        return false;
    }

    return typeof value.apiName === 'string'
        && value.apiName.length > 0
        && typeof value.globalPercentage === 'number'
        && Number.isFinite ( value.globalPercentage )
        && value.globalPercentage >= 0
        && value.globalPercentage <= 100;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGlobalAchievementRarity
//
// Description:
//
//   Determines whether the supplied value satisfies the global achievement rarity contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the global achievement rarity contract.
//
//---------------------------------------------------------------------------------------------------------------------

export function isGlobalAchievementRarity ( value: unknown ): value is GlobalAchievementRarity
{
    return isJsonObject ( value )
        && Array.isArray ( value.achievements )
        && value.achievements.every ( isGlobalAchievementPercentage );
}

//---------------------------------------------------------------------------------------------------------------------
// Shared achievement cache orchestration.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: readAchievementCapability
//
// Description:
//
//   Retrieves achievement capability through the appropriate application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// Returns:
//
//   The resulting Promise<AchievementCapabilitySummary | null> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function readAchievementCapability
(
    appId: number,
    sharedCache: SharedCache,
): Promise<AchievementCapabilitySummary | null>
{
    return sharedCache.read ( achievementCapabilityCacheKey ( appId ), isAchievementCapabilitySummary );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: loadAchievementCapability
//
// Description:
//
//   Retrieves achievement capability through the appropriate application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<AchievementCapabilitySummary> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function loadAchievementCapability
(
    appId: number,
    sharedCache: SharedCache,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<AchievementCapabilitySummary>
{
    const cachedCapability = await readAchievementCapability ( appId, sharedCache );

    if ( cachedCapability !== null )
    {
        return cachedCapability;
    }

    // Re-read the schema cache immediately before the loader is allowed to contact Steam. A concurrent discovery
    // request may have populated the schema since the initial capability read.

    const schema = await loadAchievementSchema ( appId, sharedCache, apiKey, fetchFunction );
    const capability: AchievementCapabilitySummary =
    {
        achievementCount: schema.achievements.length,
        hasAchievements:  schema.achievements.length > 0,
    };

    await sharedCache.write (
        achievementCapabilityCacheKey ( appId ),
        capability,
        SHARED_CACHE_TTL_SECONDS.achievementCapability,
    );

    return capability;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: loadAchievementSchema
//
// Description:
//
//   Retrieves achievement schema through the appropriate application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<AchievementSchema> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function loadAchievementSchema
(
    appId: number,
    sharedCache: SharedCache,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<AchievementSchema>
{
    return sharedCache.getOrLoad (
        {
            key:               achievementSchemaCacheKey ( appId ),
            loader: () => getAchievementSchema ( appId, apiKey, fetchFunction ),
            timeToLiveSeconds: SHARED_CACHE_TTL_SECONDS.achievementSchema,
            validate:          isAchievementSchema,
        },
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: loadAchievementItemProgressSchema
//
// Description:
//
//   Retrieves achievement item progress schema through the appropriate application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<AchievementItemProgressSchema> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function loadAchievementItemProgressSchema
(
    appId: number,
    sharedCache: SharedCache,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<AchievementItemProgressSchema>
{
    return sharedCache.getOrLoad (
        {
            key:               achievementItemProgressSchemaCacheKey ( appId ),
            loader: () => getAchievementItemProgressSchema ( appId, apiKey, fetchFunction ),
            timeToLiveSeconds: SHARED_CACHE_TTL_SECONDS.achievementItemProgressSchema,
            validate:          isAchievementItemProgressSchema,
        },
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: loadGlobalAchievementRarity
//
// Description:
//
//   Retrieves global achievement rarity through the appropriate application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<GlobalAchievementRarity> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function loadGlobalAchievementRarity
(
    appId: number,
    sharedCache: SharedCache,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<GlobalAchievementRarity>
{
    return sharedCache.getOrLoad (
        {
            key:               globalRarityCacheKey ( appId ),
            loader: () => getGlobalAchievementRarity ( appId, apiKey, fetchFunction ),
            timeToLiveSeconds: SHARED_CACHE_TTL_SECONDS.globalRarity,
            validate:          isGlobalAchievementRarity,
        },
    );
}
