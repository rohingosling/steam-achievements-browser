//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-29
// Author:  Rohin Gosling
//
// Description:
//
//   Cloudflare Worker entry point. API paths are handled here while non-API requests are delegated to the Workers
//   Static Assets binding.
//
// TODO:
//
//   1. Add the remaining Steam API routes in their corresponding development phases.
//
//---------------------------------------------------------------------------------------------------------------------

import { discoverGameAchievements, enrichGamesWithCachedCapabilities } from './api/discovery';
import { GameDiscoveryCursorError } from './api/discovery-cursor';
import { retrieveVisibleGames, retrieveVisibleLibraryGames } from './api/games';
import {
    retrieveSelectedGameAchievements,
    SelectedGameAchievementsError,
} from './api/achievements';
import { retrieveSteamImage, SteamImageProxyError } from './api/image';
import { resolveUser } from './api/user';
import { createSharedCache } from './cache/kv-cache';
import type { WorkerEnvironment } from './environment';
import { SteamClientError } from './steam/client';
import { SteamUserError } from './steam/identity';
import { SteamLibraryError } from './steam/library';
import { probeSteamApi } from './steam/status';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const API_PATH           = '/api';
const API_PATH_PREFIX    = '/api/';
const HEALTH_PATH        = '/api/health';
const IMAGE_PATH         = '/api/images';
const STEAM_STATUS_PATH  = '/api/steam/status';
const USER_PATH_PREFIX   = '/api/users/';
const JSON_CONTENT_TYPE  = 'application/json; charset=utf-8';
const METHOD_NOT_ALLOWED = 405;
const NOT_FOUND          = 404;
const OK                 = 200;

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

interface ErrorResponseBody
{
    error:
    {
        code: string;
        message: string;
    };
}

//---------------------------------------------------------------------------------------------------------------------
// Response helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: jsonResponse
//
// Description:
//
//   Builds the normalized JSON response returned by the Worker route.
//
// Parameters:
//
// - body (unknown):
//   The body used by the operation.
//
// - status (number):
//   The safe HTTP status associated with the normalized error.
//
// - additionalHeaders (HeadersInit):
//   Additional response headers to merge into the normalized response.
//
// Returns:
//
//   The resulting Response value.
//
//---------------------------------------------------------------------------------------------------------------------

function jsonResponse ( body: unknown, status: number, additionalHeaders: HeadersInit = {} ): Response
{
    const headers = new Headers ( additionalHeaders );

    headers.set ( 'cache-control', 'no-store' );
    headers.set ( 'content-type', JSON_CONTENT_TYPE );

    return new Response ( JSON.stringify ( body ), { headers, status } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: apiErrorResponse
//
// Description:
//
//   Builds the normalized API error response returned by the Worker route.
//
// Parameters:
//
// - code (string):
//   The normalized machine-readable error code.
//
// - message (string):
//   The human-readable status or error message.
//
// - status (number):
//   The safe HTTP status associated with the normalized error.
//
// - additionalHeaders (HeadersInit):
//   Additional response headers to merge into the normalized response.
//
// Returns:
//
//   The resulting Response value.
//
//---------------------------------------------------------------------------------------------------------------------

function apiErrorResponse
(
    code: string,
    message: string,
    status: number,
    additionalHeaders: HeadersInit = {},
): Response
{
    const body: ErrorResponseBody =
    {
        error:
        {
            code,
            message,
        },
    };

    return jsonResponse ( body, status, additionalHeaders );
}

//---------------------------------------------------------------------------------------------------------------------
// Routing.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isApiPath
//
// Description:
//
//   Determines whether the supplied value satisfies the API path contract.
//
// Parameters:
//
// - pathname (string):
//   The pathname used by the operation.
//
// Returns:
//
//   Whether the supplied value satisfies the API path contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isApiPath ( pathname: string ): boolean
{
    return pathname === API_PATH || pathname.startsWith ( API_PATH_PREFIX );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: methodNotAllowedResponse
//
// Description:
//
//   Builds the normalized method not allowed response returned by the Worker route.
//
// Returns:
//
//   The resulting Response value.
//
//---------------------------------------------------------------------------------------------------------------------

function methodNotAllowedResponse (): Response
{
    return apiErrorResponse (
        'METHOD_NOT_ALLOWED',
        'This endpoint accepts GET requests only.',
        METHOD_NOT_ALLOWED,
        { allow: 'GET' },
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: imageResponse
//
// Description:
//
//   Retrieves one allow-listed Steam raster image for same-origin screenshot composition.
//
// Parameters:
//
// - request (Request):
//   The incoming application HTTP request.
//
// Returns:
//
//   The resulting Promise<Response> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function imageResponse ( request: Request ): Promise<Response>
{
    const imageUrl = new URL ( request.url ).searchParams.get ( 'url' );

    if ( imageUrl === null )
    {
        return apiErrorResponse ( 'STEAM_IMAGE_INVALID', 'A Steam image URL is required.', 400 );
    }

    try
    {
        return await retrieveSteamImage ( imageUrl );
    }
    catch ( error )
    {
        if ( error instanceof SteamImageProxyError )
        {
            return apiErrorResponse ( error.code, error.message, error.status );
        }

        return apiErrorResponse (
            'STEAM_IMAGE_UNAVAILABLE',
            'The requested Steam image is currently unavailable.',
            502,
        );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: steamStatusResponse
//
// Description:
//
//   Builds the normalized steam status response returned by the Worker route.
//
// Parameters:
//
// - environment (WorkerEnvironment):
//   The Cloudflare Worker bindings used by the request.
//
// Returns:
//
//   The resulting Promise<Response> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function steamStatusResponse ( environment: WorkerEnvironment ): Promise<Response>
{
    try
    {
        await probeSteamApi ( environment.STEAM_API_KEY );

        return jsonResponse (
            {
                service: 'steam-web-api',
                status:  'ok',
            },
            OK,
        );
    }
    catch ( error )
    {
        if ( error instanceof SteamClientError )
        {
            return apiErrorResponse ( error.code, error.message, error.status );
        }

        return apiErrorResponse ( 'STEAM_UNAVAILABLE', 'Steam is currently unavailable.', 503 );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: decodeUserIdentifier
//
// Description:
//
//   Decodes and validates user identifier.
//
// Parameters:
//
// - pathname (string):
//   The pathname used by the operation.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function decodeUserIdentifier ( pathname: string ): string | null
{
    if ( !pathname.startsWith ( USER_PATH_PREFIX ) )
    {
        return null;
    }

    const encodedIdentifier = pathname.slice ( USER_PATH_PREFIX.length );

    if ( encodedIdentifier.length === 0 || encodedIdentifier.includes ( '/' ) )
    {
        return null;
    }

    try
    {
        return decodeURIComponent ( encodedIdentifier );
    }
    catch
    {
        return encodedIdentifier;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: decodeGamesSteamId
//
// Description:
//
//   Decodes and validates games STEAMID64.
//
// Parameters:
//
// - pathname (string):
//   The pathname used by the operation.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function decodeGamesSteamId ( pathname: string ): string | null
{
    const pathMatch = /^\/api\/users\/([^/]+)\/games$/.exec ( pathname );

    if ( pathMatch === null || pathMatch [ 1 ] === undefined )
    {
        return null;
    }

    try
    {
        return decodeURIComponent ( pathMatch [ 1 ] );
    }
    catch
    {
        return pathMatch [ 1 ];
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: decodeDiscoverySteamId
//
// Description:
//
//   Decodes and validates discovery STEAMID64.
//
// Parameters:
//
// - pathname (string):
//   The pathname used by the operation.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function decodeDiscoverySteamId ( pathname: string ): string | null
{
    const pathMatch = /^\/api\/users\/([^/]+)\/games\/discover$/.exec ( pathname );

    if ( pathMatch === null || pathMatch [ 1 ] === undefined )
    {
        return null;
    }

    try
    {
        return decodeURIComponent ( pathMatch [ 1 ] );
    }
    catch
    {
        return pathMatch [ 1 ];
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: decodeSelectedGamePath
//
// Description:
//
//   Decodes and validates selected game path.
//
// Parameters:
//
// - pathname (string):
//   The pathname used by the operation.
//
// Returns:
//
//   The resulting { appId: number; steamId: string } | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function decodeSelectedGamePath ( pathname: string ): { appId: number; steamId: string } | null
{
    const pathMatch = /^\/api\/users\/([^/]+)\/games\/([^/]+)\/achievements$/.exec ( pathname );

    if ( pathMatch === null || pathMatch [ 1 ] === undefined || pathMatch [ 2 ] === undefined )
    {
        return null;
    }

    let steamId: string;

    try
    {
        steamId = decodeURIComponent ( pathMatch [ 1 ] );
    }
    catch
    {
        steamId = pathMatch [ 1 ];
    }

    const appIdText = pathMatch [ 2 ];
    const appId     = /^\d+$/.test ( appIdText ) ? Number ( appIdText ) : Number.NaN;

    return (
        { appId, steamId }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: userResponse
//
// Description:
//
//   Builds the normalized user response returned by the Worker route.
//
// Parameters:
//
// - request (Request):
//   The incoming application HTTP request.
//
// - identifier (string):
//   The Steam identifier supplied by the user or a normalized parser stage.
//
// - environment (WorkerEnvironment):
//   The Cloudflare Worker bindings used by the request.
//
// Returns:
//
//   The resulting Promise<Response> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function userResponse ( request: Request, identifier: string, environment: WorkerEnvironment ): Promise<Response>
{
    try
    {
        const user = await resolveUser ( identifier, request.url, environment.STEAM_API_KEY );

        return jsonResponse ( user, OK );
    }
    catch ( error )
    {
        if ( error instanceof SteamUserError || error instanceof SteamClientError )
        {
            return apiErrorResponse ( error.code, error.message, error.status );
        }

        return apiErrorResponse ( 'STEAM_UNAVAILABLE', 'Steam is currently unavailable.', 503 );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: gamesResponse
//
// Description:
//
//   Builds the normalized games response returned by the Worker route.
//
// Parameters:
//
// - request (Request):
//   The incoming application HTTP request.
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - environment (WorkerEnvironment):
//   The Cloudflare Worker bindings used by the request.
//
// Returns:
//
//   The resulting Promise<Response> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function gamesResponse ( request: Request, steamId: string, environment: WorkerEnvironment ): Promise<Response>
{
    try
    {
        const sharedCache = createSharedCache ( environment.GAME_CACHE );
        const library     = await retrieveVisibleGames (
            steamId,
            request.url,
            environment.STEAM_API_KEY,
            sharedCache,
        );

        return jsonResponse ( library, OK );
    }
    catch ( error )
    {
        if ( error instanceof SteamLibraryError || error instanceof SteamClientError )
        {
            return apiErrorResponse ( error.code, error.message, error.status );
        }

        return apiErrorResponse ( 'STEAM_UNAVAILABLE', 'Steam is currently unavailable.', 503 );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: discoveryResponse
//
// Description:
//
//   Discovers y response in a bounded batch and returns continuation state.
//
// Parameters:
//
// - request (Request):
//   The incoming application HTTP request.
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - environment (WorkerEnvironment):
//   The Cloudflare Worker bindings used by the request.
//
// Returns:
//
//   The resulting Promise<Response> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function discoveryResponse
(
    request: Request,
    steamId: string,
    environment: WorkerEnvironment,
): Promise<Response>
{
    try
    {
        const cursor = new URL ( request.url ).searchParams.get ( 'cursor' );

        if ( cursor === null )
        {
            throw new GameDiscoveryCursorError ();
        }

        const sharedCache = createSharedCache ( environment.GAME_CACHE );
        const visibleGames = await retrieveVisibleLibraryGames (
            steamId,
            request.url,
            environment.STEAM_API_KEY,
        );
        const enrichedGames = await enrichGamesWithCachedCapabilities ( visibleGames, sharedCache );
        const discovery     = await discoverGameAchievements (
            enrichedGames,
            cursor,
            sharedCache,
            environment.STEAM_API_KEY,
        );

        return jsonResponse ( discovery, OK );
    }
    catch ( error )
    {
        if (
            error instanceof GameDiscoveryCursorError
            || error instanceof SteamLibraryError
            || error instanceof SteamClientError
        )
        {
            return apiErrorResponse ( error.code, error.message, error.status );
        }

        return apiErrorResponse ( 'STEAM_UNAVAILABLE', 'Steam is currently unavailable.', 503 );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: selectedGameAchievementsResponse
//
// Description:
//
//   Retrieves a selected game's normalized achievements and maps safe domain failures to API responses.
//
// Parameters:
//
// - request (Request):
//   The incoming application HTTP request.
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - environment (WorkerEnvironment):
//   The Cloudflare Worker bindings used by the request.
//
// Returns:
//
//   The resulting Promise<Response> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function selectedGameAchievementsResponse
(
    request: Request,
    steamId: string,
    appId: number,
    environment: WorkerEnvironment,
): Promise<Response>
{
    try
    {
        const sharedCache = createSharedCache ( environment.GAME_CACHE );
        const achievements = await retrieveSelectedGameAchievements (
            steamId,
            appId,
            request.url,
            environment.STEAM_API_KEY,
            sharedCache,
        );

        return jsonResponse ( achievements, OK );
    }
    catch ( error )
    {
        if (
            error instanceof SelectedGameAchievementsError
            || error instanceof SteamLibraryError
            || error instanceof SteamClientError
        )
        {
            return apiErrorResponse ( error.code, error.message, error.status );
        }

        return apiErrorResponse ( 'STEAM_UNAVAILABLE', 'Steam is currently unavailable.', 503 );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: handleRequest
//
// Description:
//
//   Coordinates request across the required application boundaries.
//
// Parameters:
//
// - request (Request):
//   The incoming application HTTP request.
//
// - environment (WorkerEnvironment):
//   The Cloudflare Worker bindings used by the request.
//
// Returns:
//
//   The resulting Promise<Response> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function handleRequest ( request: Request, environment: WorkerEnvironment ): Promise<Response>
{
    const pathname         = new URL ( request.url ).pathname;
    const discoverySteamId = decodeDiscoverySteamId ( pathname );
    const gamesSteamId     = decodeGamesSteamId ( pathname );
    const selectedGamePath = decodeSelectedGamePath ( pathname );
    const userIdentifier   = decodeUserIdentifier ( pathname );

    if ( pathname === HEALTH_PATH )
    {
        if ( request.method !== 'GET' )
        {
            return methodNotAllowedResponse ();
        }

        return jsonResponse (
            {
                service: 'steam-achievement-browser',
                status:  'ok',
            },
            OK,
        );
    }

    if ( pathname === STEAM_STATUS_PATH )
    {
        if ( request.method !== 'GET' )
        {
            return methodNotAllowedResponse ();
        }

        return steamStatusResponse ( environment );
    }

    if ( pathname === IMAGE_PATH )
    {
        if ( request.method !== 'GET' )
        {
            return methodNotAllowedResponse ();
        }

        return imageResponse ( request );
    }

    if ( discoverySteamId !== null )
    {
        if ( request.method !== 'GET' )
        {
            return methodNotAllowedResponse ();
        }

        return discoveryResponse ( request, discoverySteamId, environment );
    }

    if ( selectedGamePath !== null )
    {
        if ( request.method !== 'GET' )
        {
            return methodNotAllowedResponse ();
        }

        return selectedGameAchievementsResponse (
            request,
            selectedGamePath.steamId,
            selectedGamePath.appId,
            environment,
        );
    }

    if ( gamesSteamId !== null )
    {
        if ( request.method !== 'GET' )
        {
            return methodNotAllowedResponse ();
        }

        return gamesResponse ( request, gamesSteamId, environment );
    }

    if ( userIdentifier !== null )
    {
        if ( request.method !== 'GET' )
        {
            return methodNotAllowedResponse ();
        }

        return userResponse ( request, userIdentifier, environment );
    }

    // API misses must remain API responses. Delegating them to the asset binding could expose an HTML fallback as if
    // it were an application endpoint.

    if ( isApiPath ( pathname ) )
    {
        return apiErrorResponse ( 'API_ROUTE_NOT_FOUND', 'The requested API route does not exist.', NOT_FOUND );
    }

    return environment.ASSETS.fetch ( request );
}

export default
{
    fetch: handleRequest,
};
