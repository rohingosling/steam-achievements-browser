//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Visible Steam-library endpoint adapter. Raw GetOwnedGames records are validated, normalized, and deduplicated
//   before they cross the application API boundary. Private game details and a genuinely empty visible library remain
//   distinct expected states.
//
// TODO:
//
//   1. Enrich normalized games with shared achievement-capability cache data in Phase 6.
//
//---------------------------------------------------------------------------------------------------------------------

import type { GameSummary } from '../model/api';
import { isJsonObject, requestSteamJson, SteamRequestFailedError } from './client';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const BAD_REQUEST                  = 400;
const FORBIDDEN                    = 403;
const UNAUTHORIZED                 = 401;
const NOT_FOUND                    = 404;
const MAXIMUM_APP_ID               = 4_294_967_295;
const STEAM_GAME_ICON_ORIGIN       = 'https://media.steampowered.com';
const STEAM_GAME_ICON_HASH_PATTERN = /^[A-Fa-f0-9]{40}$/;
const STEAM_ID_PATTERN             = /^\d{17}$/;

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

interface GetOwnedGamesResponse
{
    response:
    {
        game_count?: number;
        games?: unknown [];
    };
}

export type SteamLibraryErrorCode =
    'STEAM_GAME_DETAILS_PRIVATE'
    | 'STEAM_LIBRARY_EMPTY'
    | 'STEAM_USER_IDENTIFIER_INVALID';

//---------------------------------------------------------------------------------------------------------------------
// Normalized errors.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamLibraryError
//
// Description:
//
//   Represents a normalized steam library failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamLibraryError extends Error
{
    public readonly code: SteamLibraryErrorCode;
    public readonly status: number;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamLibraryError instance with the supplied dependencies and state.
    //
    // Parameters:
    //
    // - code (SteamLibraryErrorCode):
    //   The normalized machine-readable error code.
    //
    // - message (string):
    //   The human-readable status or error message.
    //
    // - status (number):
    //   The safe HTTP status associated with the normalized error.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ( code: SteamLibraryErrorCode, message: string, status: number )
    {
        super ( message );

        this.name   = 'SteamLibraryError';
        this.code   = code;
        this.status = status;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: InvalidSteamIdError
//
// Description:
//
//   Represents a normalized invalid STEAMID64 failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class InvalidSteamIdError extends SteamLibraryError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes an InvalidSteamIdError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super ( 'STEAM_USER_IDENTIFIER_INVALID', 'The Steam user identifier is invalid.', BAD_REQUEST );

        this.name = 'InvalidSteamIdError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamGameDetailsPrivateError
//
// Description:
//
//   Represents a normalized steam game details private failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamGameDetailsPrivateError extends SteamLibraryError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamGameDetailsPrivateError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_GAME_DETAILS_PRIVATE',
            "This user's Steam Game Details are not publicly visible. If this is your profile, open Profile > Edit "
                + 'Profile > Privacy Settings, set Game Details to Public, then try again.',
            FORBIDDEN,
        );

        this.name = 'SteamGameDetailsPrivateError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamLibraryEmptyError
//
// Description:
//
//   Represents a normalized steam library empty failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamLibraryEmptyError extends SteamLibraryError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamLibraryEmptyError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super ( 'STEAM_LIBRARY_EMPTY', 'No publicly visible Steam games were found for this user.', NOT_FOUND );

        this.name = 'SteamLibraryEmptyError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Response validation and normalization.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isGetOwnedGamesResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the get owned games response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the get owned games response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGetOwnedGamesResponse ( value: unknown ): value is GetOwnedGamesResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.response ) )
    {
        return false;
    }

    const response = value.response;

    return ( response.game_count === undefined || typeof response.game_count === 'number' )
        && ( response.games === undefined || Array.isArray ( response.games ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeIconUrl
//
// Description:
//
//   Normalizes icon URL into the application contract.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeIconUrl ( appId: number, value: unknown ): string | null
{
    if ( typeof value !== 'string' || !STEAM_GAME_ICON_HASH_PATTERN.test ( value ) )
    {
        return null;
    }

    return `${STEAM_GAME_ICON_ORIGIN}/steamcommunity/public/images/apps/${appId}/${value.toLowerCase ()}.jpg`;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizePlaytimeMinutes
//
// Description:
//
//   Normalizes playtime minutes into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting number value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizePlaytimeMinutes ( value: unknown ): number
{
    if ( typeof value !== 'number' || !Number.isFinite ( value ) || value < 0 )
    {
        return 0;
    }

    return Math.floor ( value );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeOwnedGame
//
// Description:
//
//   Normalizes owned game into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting GameSummary | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeOwnedGame ( value: unknown ): GameSummary | null
{
    if ( !isJsonObject ( value ) )
    {
        return null;
    }

    const appId = value.appid;
    const name  = typeof value.name === 'string' ? value.name.trim () : '';

    if (
        typeof appId !== 'number'
        || !Number.isSafeInteger ( appId )
        || appId < 1
        || appId > MAXIMUM_APP_ID
        || name.length === 0
    )
    {
        return null;
    }

    return (
        {
            achievementCapability: 'unknown',
            achievementCount:      null,
            appId,
            bannerUrl:             null,
            iconUrl:               normalizeIconUrl ( appId, value.img_icon_url ),
            name,
            playtimeMinutes:       normalizePlaytimeMinutes ( value.playtime_forever ),
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: mergeDuplicateGame
//
// Description:
//
//   Combines the supplied data sources into duplicate game.
//
// Parameters:
//
// - existingGame (GameSummary):
//   The existing game used by the operation.
//
// - duplicateGame (GameSummary):
//   The duplicate game used by the operation.
//
// Returns:
//
//   The resulting GameSummary value.
//
//---------------------------------------------------------------------------------------------------------------------

function mergeDuplicateGame ( existingGame: GameSummary, duplicateGame: GameSummary ): GameSummary
{
    return (
        {
            ...existingGame,
            iconUrl:         existingGame.iconUrl ?? duplicateGame.iconUrl,
            playtimeMinutes: Math.max ( existingGame.playtimeMinutes, duplicateGame.playtimeMinutes ),
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: validateSteamId
//
// Description:
//
//   Validates STEAMID64 before it crosses the application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function validateSteamId ( steamId: string ): void
{
    if ( !STEAM_ID_PATTERN.test ( steamId ) )
    {
        throw new InvalidSteamIdError ();
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeOwnedGames
//
// Description:
//
//   Normalizes owned games into the application contract.
//
// Parameters:
//
// - values (readonly unknown []):
//   The values to validate, normalize, or store.
//
// Returns:
//
//   The resulting GameSummary [] value.
//
//---------------------------------------------------------------------------------------------------------------------

export function normalizeOwnedGames ( values: readonly unknown [] ): GameSummary []
{
    const gamesByAppId = new Map<number, GameSummary> ();

    for ( const value of values )
    {
        const game = normalizeOwnedGame ( value );

        if ( game === null )
        {
            continue;
        }

        const existingGame = gamesByAppId.get ( game.appId );

        gamesByAppId.set (
            game.appId,
            existingGame === undefined ? game : mergeDuplicateGame ( existingGame, game ),
        );
    }

    return Array.from ( gamesByAppId.values () );
}

//---------------------------------------------------------------------------------------------------------------------
// Endpoint adapter.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: getOwnedGames
//
// Description:
//
//   Retrieves owned games through the appropriate application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<GameSummary []> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function getOwnedGames
(
    steamId: string,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<GameSummary []>
{
    validateSteamId ( steamId );

    let response: GetOwnedGamesResponse;

    try
    {
        response = await requestSteamJson (
            {
                interfaceName: 'IPlayerService',
                methodName:    'GetOwnedGames',
                parameters:
                {
                    format:                    'json',
                    include_appinfo:           true,
                    include_played_free_games: true,
                    steamid:                   steamId,
                },
                validate: isGetOwnedGamesResponse,
                version:  1,
            },
            {
                apiKey,
                fetchFunction,
            },
        );
    }
    catch ( error )
    {
        // This translation is deliberately scoped to a user-data endpoint. The normal browser flow has already used
        // the same key to resolve the profile, so an access denial here represents hidden Game Details rather than a
        // global rule that every Steam authorization response means privacy.

        if (
            error instanceof SteamRequestFailedError
            && ( error.upstreamStatus === UNAUTHORIZED || error.upstreamStatus === FORBIDDEN )
        )
        {
            throw new SteamGameDetailsPrivateError ();
        }

        throw error;
    }

    if ( response.response.games === undefined )
    {
        throw new SteamGameDetailsPrivateError ();
    }

    const games = normalizeOwnedGames ( response.response.games );

    if ( games.length === 0 )
    {
        throw new SteamLibraryEmptyError ();
    }

    return games;
}
