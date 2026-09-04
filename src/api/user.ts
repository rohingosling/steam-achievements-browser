//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   User-resolution API orchestration, including the short-lived Workers Cache API layer. Cached records are public
//   profile summaries only and never enter persistent shared storage.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { EDGE_CACHE_TTL_SECONDS } from '../cache/cache-policy';
import type { UserSummary } from '../model/api';
import {
    createSteamIdentifierCacheKey,
    parseSteamIdentifier,
    resolveSteamUser,
} from '../steam/identity';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const CACHE_KEY_PATH_PREFIX = '/__edge-cache/user-profile/v1/';
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
// - identifierCacheKey (string):
//   The identifier cache key used by the operation.
//
// Returns:
//
//   The resulting Request value.
//
//---------------------------------------------------------------------------------------------------------------------

function createCacheRequest ( requestUrl: string, identifierCacheKey: string ): Request
{
    const cacheUrl = new URL ( `${CACHE_KEY_PATH_PREFIX}${identifierCacheKey}`, requestUrl );

    cacheUrl.search = '';
    cacheUrl.hash   = '';

    return new Request ( cacheUrl, { method: 'GET' } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isUserSummary
//
// Description:
//
//   Determines whether the supplied value satisfies the user summary contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the user summary contract.
//
//---------------------------------------------------------------------------------------------------------------------

export function isUserSummary ( value: unknown ): value is UserSummary
{
    if ( typeof value !== 'object' || value === null || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return ( candidate.avatarUrl === null || typeof candidate.avatarUrl === 'string' )
        && typeof candidate.personaName === 'string'
        && typeof candidate.profileUrl === 'string'
        && typeof candidate.steamId === 'string';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: readCachedUser
//
// Description:
//
//   Retrieves cached user through the appropriate application boundary.
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
//   The resulting Promise<UserSummary | null> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function readCachedUser ( edgeCache: Cache | undefined, cacheRequest: Request ): Promise<UserSummary | null>
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

        return isUserSummary ( cachedValue ) ? cachedValue : null;
    }
    catch
    {
        return null;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: writeCachedUser
//
// Description:
//
//   Writes cached user without exposing implementation details to callers.
//
// Parameters:
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// - cacheRequest (Request):
//   The synthetic request used as the edge-cache key.
//
// - user (UserSummary):
//   The normalized Steam user associated with the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function writeCachedUser ( edgeCache: Cache | undefined, cacheRequest: Request, user: UserSummary ): Promise<void>
{
    if ( edgeCache === undefined )
    {
        return;
    }

    const response = new Response (
        JSON.stringify ( user ),
        {
            headers:
            {
                'cache-control': `public, max-age=${EDGE_CACHE_TTL_SECONDS.userProfile}`,
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
        // A short-lived cache is an optimization. Its failure must not turn valid Steam data into an API failure.
    }
}

//---------------------------------------------------------------------------------------------------------------------
// User resolution.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: resolveUser
//
// Description:
//
//   Resolves user into the normalized value required by its caller.
//
// Parameters:
//
// - identifier (string):
//   The Steam identifier supplied by the user or a normalized parser stage.
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
//   The resulting Promise<UserSummary> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function resolveUser
(
    identifier: string,
    requestUrl: string,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
    edgeCache: Cache | undefined = getDefaultEdgeCache (),
): Promise<UserSummary>
{
    const parsedIdentifier   = parseSteamIdentifier ( identifier );
    const identifierCacheKey = createSteamIdentifierCacheKey ( parsedIdentifier );
    const cacheRequest       = createCacheRequest ( requestUrl, identifierCacheKey );
    const cachedUser         = await readCachedUser ( edgeCache, cacheRequest );

    if ( cachedUser !== null )
    {
        return cachedUser;
    }

    const user = await resolveSteamUser ( parsedIdentifier, apiKey, fetchFunction );

    await writeCachedUser ( edgeCache, cacheRequest, user );

    if ( parsedIdentifier.kind === 'vanity' )
    {
        const steamIdCacheRequest = createCacheRequest ( requestUrl, `steam-id/${user.steamId}` );

        await writeCachedUser ( edgeCache, steamIdCacheRequest, user );
    }

    return user;
}
