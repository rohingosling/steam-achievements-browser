//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Visible-library API orchestration and short-lived Workers Cache API handling. The user-specific library remains
//   edge data; each response is enriched from globally shared capability entries without persisting owned-game data.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { SharedCache } from '../cache/cache';
import { EDGE_CACHE_TTL_SECONDS } from '../cache/cache-policy';
import type { GameLibrarySummary, GameSummary } from '../model/api';
import { getOwnedGames, validateSteamId } from '../steam/library';
import { createInitialDiscoveryCursor, enrichGamesWithCachedCapabilities } from './discovery';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const CACHE_KEY_PATH_PREFIX = '/__edge-cache/user-library/v1/';
const JSON_CONTENT_TYPE     = 'application/json; charset=utf-8';

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

interface DefaultCacheStorage
{
    default?: Cache;
}

//---------------------------------------------------------------------------------------------------------------------
// Cache helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: getDefaultEdgeCache
//
// Description:
//
//   Retrieves default edge cache through the appropriate application boundary.
//
// Returns:
//
//   The resulting Cache | undefined value.
//
//---------------------------------------------------------------------------------------------------------------------

function getDefaultEdgeCache (): Cache | undefined
{
    const cacheStorage = ( globalThis as typeof globalThis & { caches?: DefaultCacheStorage } ).caches;

    return cacheStorage?.default;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createCacheRequest
//
// Description:
//
//   Creates cache request from the supplied inputs.
//
// Parameters:
//
// - requestUrl (string):
//   The original request URL used to construct the cache key.
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// Returns:
//
//   The resulting Request value.
//
//---------------------------------------------------------------------------------------------------------------------

function createCacheRequest ( requestUrl: string, steamId: string ): Request
{
    const cacheUrl = new URL ( `${CACHE_KEY_PATH_PREFIX}${steamId}`, requestUrl );

    cacheUrl.search = '';
    cacheUrl.hash   = '';

    return new Request ( cacheUrl, { method: 'GET' } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGameSummary
//
// Description:
//
//   Determines whether the supplied value satisfies the game summary contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the game summary contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGameSummary ( value: unknown ): value is GameSummary
{
    if ( typeof value !== 'object' || value === null || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return candidate.achievementCapability === 'unknown'
        && candidate.achievementCount === null
        && typeof candidate.appId === 'number'
        && Number.isSafeInteger ( candidate.appId )
        && candidate.appId > 0
        && candidate.bannerUrl === null
        && ( candidate.iconUrl === null || typeof candidate.iconUrl === 'string' )
        && typeof candidate.name === 'string'
        && candidate.name.length > 0
        && typeof candidate.playtimeMinutes === 'number'
        && Number.isSafeInteger ( candidate.playtimeMinutes )
        && candidate.playtimeMinutes >= 0;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGameLibrarySummary
//
// Description:
//
//   Determines whether the supplied value satisfies the game library summary contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the game library summary contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGameLibrarySummary ( value: unknown ): value is GameLibrarySummary
{
    if ( typeof value !== 'object' || value === null || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return candidate.discoveryCursor === null
        && Array.isArray ( candidate.games )
        && candidate.games.length > 0
        && candidate.games.every ( isGameSummary );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: readCachedLibrary
//
// Description:
//
//   Retrieves cached library through the appropriate application boundary.
//
// Parameters:
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// - cacheRequest (Request):
//   The synthetic request used as the edge-cache key.
//
// Returns:
//
//   The resulting Promise<GameLibrarySummary | null> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function readCachedLibrary
(
    edgeCache: Cache | undefined,
    cacheRequest: Request,
): Promise<GameLibrarySummary | null>
{
    if ( edgeCache === undefined )
    {
        return null;
    }

    try
    {
        const cachedResponse = await edgeCache.match ( cacheRequest );

        if ( cachedResponse === undefined )
        {
            return null;
        }

        const cachedValue = await cachedResponse.json () as unknown;

        return isGameLibrarySummary ( cachedValue ) ? cachedValue : null;
    }
    catch
    {
        return null;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: writeCachedLibrary
//
// Description:
//
//   Writes cached library without exposing implementation details to callers.
//
// Parameters:
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// - cacheRequest (Request):
//   The synthetic request used as the edge-cache key.
//
// - library (GameLibrarySummary):
//   The library used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function writeCachedLibrary
(
    edgeCache: Cache | undefined,
    cacheRequest: Request,
    library: GameLibrarySummary,
): Promise<void>
{
    if ( edgeCache === undefined )
    {
        return;
    }

    const response = new Response (
        JSON.stringify ( library ),
        {
            headers:
            {
                'cache-control': `public, max-age=${EDGE_CACHE_TTL_SECONDS.userLibrary}`,
                'content-type':  JSON_CONTENT_TYPE,
            },
        },
    );

    try
    {
        await edgeCache.put ( cacheRequest, response );
    }
    catch
    {
        // The library cache is an optimization. A write failure must not discard successfully normalized live data.
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Library retrieval.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: retrieveVisibleLibraryGames
//
// Description:
//
//   Retrieves visible library games through the appropriate application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - requestUrl (string):
//   The original request URL used to construct the cache key.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// Returns:
//
//   The resulting Promise<GameSummary []> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function retrieveVisibleLibraryGames
(
    steamId: string,
    requestUrl: string,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
    edgeCache: Cache | undefined = getDefaultEdgeCache (),
): Promise<GameSummary []>
{
    validateSteamId ( steamId );

    const cacheRequest  = createCacheRequest ( requestUrl, steamId );
    const cachedLibrary = await readCachedLibrary ( edgeCache, cacheRequest );

    if ( cachedLibrary !== null )
    {
        return cachedLibrary.games;
    }

    const library: GameLibrarySummary =
    {
        discoveryCursor: null,
        games:           await getOwnedGames ( steamId, apiKey, fetchFunction ),
    };

    await writeCachedLibrary ( edgeCache, cacheRequest, library );

    return library.games;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: retrieveVisibleGames
//
// Description:
//
//   Retrieves visible games through the appropriate application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - requestUrl (string):
//   The original request URL used to construct the cache key.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// Returns:
//
//   The resulting Promise<GameLibrarySummary> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function retrieveVisibleGames
(
    steamId: string,
    requestUrl: string,
    apiKey: string | undefined,
    sharedCache: SharedCache,
    fetchFunction: typeof fetch = fetch,
    edgeCache: Cache | undefined = getDefaultEdgeCache (),
): Promise<GameLibrarySummary>
{
    const visibleGames = await retrieveVisibleLibraryGames (
        steamId,
        requestUrl,
        apiKey,
        fetchFunction,
        edgeCache,
    );
    const enrichedGames = await enrichGamesWithCachedCapabilities ( visibleGames, sharedCache );

    return (
        {
            discoveryCursor: createInitialDiscoveryCursor ( enrichedGames ),
            games:           enrichedGames,
        }
    );
}
