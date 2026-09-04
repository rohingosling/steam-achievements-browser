//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Typed shared-cache orchestration for normalized game display metadata. Library Hero and Store artwork candidates
//   remain ordered while library name and icon values provide deterministic final fallbacks.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import type { GameMetadata } from '../model/api';
import { createLibraryHeroUrl, createLibraryLogoUrls, getStoreArtwork } from '../steam/store';
import { gameMetadataCacheKey } from './cache-keys';
import { SHARED_CACHE_TTL_SECONDS } from './cache-policy';
import { SharedCache } from './cache';

//---------------------------------------------------------------------------------------------------------------------
// Validation helpers.
//---------------------------------------------------------------------------------------------------------------------

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
// Function: isStringArray
//
// Description:
//
//   Determines whether the supplied value satisfies the string array contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the string array contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isStringArray ( value: unknown ): value is string []
{
    return Array.isArray ( value ) && value.every ( item => typeof item === 'string' && item.length > 0 );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGameMetadata
//
// Description:
//
//   Determines whether the supplied value satisfies the game metadata contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the game metadata contract.
//
//---------------------------------------------------------------------------------------------------------------------

export function isGameMetadata ( value: unknown ): value is GameMetadata
{
    if ( typeof value !== 'object' || value === null || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return Number.isSafeInteger ( candidate.appId )
        && ( candidate.appId as number ) > 0
        && isStringArray ( candidate.bannerUrls )
        && isNullableString ( candidate.iconUrl )
        && isStringArray ( candidate.libraryLogoUrls )
        && typeof candidate.name === 'string'
        && candidate.name.length > 0;
}

//---------------------------------------------------------------------------------------------------------------------
// Shared metadata cache orchestration.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: loadGameMetadata
//
// Description:
//
//   Retrieves game metadata through the appropriate application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - fallbackName (string):
//   The fallback name used by the operation.
//
// - fallbackIconUrl (string | null):
//   The fallback icon URL used by the operation.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<GameMetadata> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function loadGameMetadata
(
    appId: number,
    fallbackName: string,
    fallbackIconUrl: string | null,
    sharedCache: SharedCache,
    fetchFunction: typeof fetch = fetch,
): Promise<GameMetadata>
{
    return sharedCache.getOrLoad (
        {
            key: gameMetadataCacheKey ( appId ),
            loader: async () =>
            {
                const artwork = await getStoreArtwork ( appId, fetchFunction );

                return (
                    {
                        appId,
                        bannerUrls:
                        [
                            createLibraryHeroUrl ( appId ),
                            ... ( artwork?.bannerUrls ?? [] ),
                        ],
                        iconUrl:         fallbackIconUrl,
                        libraryLogoUrls: createLibraryLogoUrls ( appId ),
                        name:            artwork?.name ?? fallbackName,
                    }
                );
            },
            timeToLiveSeconds: SHARED_CACHE_TTL_SECONDS.gameMetadata,
            validate:          isGameMetadata,
        },
    );
}
