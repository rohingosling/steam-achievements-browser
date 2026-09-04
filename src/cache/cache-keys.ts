//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Versioned key construction for persistent shared game metadata. AppIDs are validated before interpolation so
//   user-provided route values can never become arbitrary KV keys.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const MAXIMUM_APP_ID = 4_294_967_295;

export const SHARED_CACHE_OBJECT_VERSION =
{
    achievementCapability:         1,
    achievementItemProgressSchema: 1,
    achievementSchema:             1,
    gameMetadata:                  2,
    globalRarity:                  2,
} as const;

//---------------------------------------------------------------------------------------------------------------------
// AppID validation.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: requireValidAppId
//
// Description:
//
//   Validates APPID and returns the accepted value or throws a safe boundary error.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting number value.
//
//---------------------------------------------------------------------------------------------------------------------

function requireValidAppId ( appId: number ): number
{
    if ( !Number.isSafeInteger ( appId ) || appId < 1 || appId > MAXIMUM_APP_ID )
    {
        throw new RangeError ( 'A positive 32-bit Steam AppID is required for a shared-cache key.' );
    }

    return appId;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: gameKey
//
// Description:
//
//   Builds the versioned game key after validating every key component.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - suffix (string):
//   The suffix used by the operation.
//
// - version (number):
//   The cache-key or cursor format version.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

function gameKey ( appId: number, suffix: string, version: number ): string
{
    return `game:v${version}:${requireValidAppId ( appId )}:${suffix}`;
}

//---------------------------------------------------------------------------------------------------------------------
// Public cache-key families.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: gameMetadataCacheKey
//
// Description:
//
//   Builds the versioned game metadata cache key after validating every key component.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function gameMetadataCacheKey ( appId: number ): string
{
    return gameKey ( appId, 'meta', SHARED_CACHE_OBJECT_VERSION.gameMetadata );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: achievementCapabilityCacheKey
//
// Description:
//
//   Builds the versioned achievement capability cache key after validating every key component.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function achievementCapabilityCacheKey ( appId: number ): string
{
    return gameKey ( appId, 'achievement-capability', SHARED_CACHE_OBJECT_VERSION.achievementCapability );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: achievementSchemaCacheKey
//
// Description:
//
//   Builds the versioned achievement schema cache key after validating every key component.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function achievementSchemaCacheKey ( appId: number ): string
{
    return gameKey ( appId, 'schema:en', SHARED_CACHE_OBJECT_VERSION.achievementSchema );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: achievementItemProgressSchemaCacheKey
//
// Description:
//
//   Builds the versioned achievement item progress schema cache key after validating every key component.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function achievementItemProgressSchemaCacheKey ( appId: number ): string
{
    return gameKey (
        appId,
        'item-progress-schema:en',
        SHARED_CACHE_OBJECT_VERSION.achievementItemProgressSchema,
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: globalRarityCacheKey
//
// Description:
//
//   Builds the versioned global rarity cache key after validating every key component.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function globalRarityCacheKey ( appId: number ): string
{
    return gameKey ( appId, 'rarity', SHARED_CACHE_OBJECT_VERSION.globalRarity );
}
