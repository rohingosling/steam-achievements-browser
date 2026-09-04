//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Steam user-identity parsing and endpoint adapters. Public input is reduced to either a validated SteamID64 or a
//   validated vanity identifier before it can become an authenticated Steam request parameter.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import type { UserSummary } from '../model/api';
import { isJsonObject, requestSteamJson, SteamInvalidResponseError } from './client';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const BAD_REQUEST               = 400;
const FORBIDDEN                 = 403;
const NOT_FOUND                 = 404;
const MAXIMUM_IDENTIFIER_LENGTH = 200;
const MAXIMUM_VANITY_LENGTH     = 64;
const MINIMUM_VANITY_LENGTH     = 2;
const STEAM_COMMUNITY_HOSTNAMES = new Set ( [ 'steamcommunity.com', 'www.steamcommunity.com' ] );
const STEAM_ID_PATTERN          = /^\d{17}$/;
const VANITY_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

export type ParsedSteamIdentifier =
    {
        kind: 'steamId';
        steamId: string;
    }
    |
    {
        kind: 'vanity';
        vanityIdentifier: string;
    };

interface ResolveVanityUrlResponse
{
    response:
    {
        message?: string;
        steamid?: string;
        success: number;
    };
}

interface SteamPlayerSummary
{
    avatar?: string;
    avatarfull?: string;
    avatarmedium?: string;
    communityvisibilitystate?: number;
    personaname?: string;
    profileurl?: string;
    steamid: string;
}

interface GetPlayerSummariesResponse
{
    response:
    {
        players: SteamPlayerSummary [];
    };
}

export type SteamUserErrorCode =
    'STEAM_PROFILE_PRIVATE'
    | 'STEAM_USER_IDENTIFIER_INVALID'
    | 'STEAM_USER_NOT_FOUND';

//---------------------------------------------------------------------------------------------------------------------
// Normalized errors.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamUserError
//
// Description:
//
//   Represents a normalized steam user failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamUserError extends Error
{
    public readonly code: SteamUserErrorCode;
    public readonly status: number;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamUserError instance with the supplied dependencies and state.
    //
    // Parameters:
    //
    // - code (SteamUserErrorCode):
    //   The normalized machine-readable error code.
    //
    // - message (string):
    //   The human-readable status or error message.
    //
    // - status (number):
    //   The safe HTTP status associated with the normalized error.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ( code: SteamUserErrorCode, message: string, status: number )
    {
        super ( message );

        this.name   = 'SteamUserError';
        this.code   = code;
        this.status = status;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: InvalidSteamUserIdentifierError
//
// Description:
//
//   Represents a normalized invalid steam user identifier failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class InvalidSteamUserIdentifierError extends SteamUserError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes an InvalidSteamUserIdentifierError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_USER_IDENTIFIER_INVALID',
            'Enter a valid SteamID64, Steam Community profile URL, or custom Steam Community URL name.',
            BAD_REQUEST,
        );

        this.name = 'InvalidSteamUserIdentifierError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamUserNotFoundError
//
// Description:
//
//   Represents a normalized steam user not found failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamUserNotFoundError extends SteamUserError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamUserNotFoundError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_USER_NOT_FOUND',
            'No Steam user was found for that identifier.',
            NOT_FOUND,
        );

        this.name = 'SteamUserNotFoundError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamProfilePrivateError
//
// Description:
//
//   Represents a normalized steam profile private failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamProfilePrivateError extends SteamUserError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamProfilePrivateError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_PROFILE_PRIVATE',
            'This Steam profile is not public. In Steam, open Profile > Edit Profile > Privacy Settings, set My '
                + 'Profile and Game Details to Public, then try again.',
            FORBIDDEN,
        );

        this.name = 'SteamProfilePrivateError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Identifier parsing.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: invalidIdentifier
//
// Description:
//
//   Creates the normalized invalid-identifier result used by every rejected input form.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function invalidIdentifier (): never
{
    throw new InvalidSteamUserIdentifierError ();
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isValidVanityIdentifier
//
// Description:
//
//   Determines whether the supplied value satisfies the valid vanity identifier contract.
//
// Parameters:
//
// - identifier (string):
//   The Steam identifier supplied by the user or a normalized parser stage.
//
// Returns:
//
//   Whether the supplied value satisfies the valid vanity identifier contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isValidVanityIdentifier ( identifier: string ): boolean
{
    return identifier.length >= MINIMUM_VANITY_LENGTH
        && identifier.length <= MAXIMUM_VANITY_LENGTH
        && VANITY_IDENTIFIER_PATTERN.test ( identifier );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: parseSteamCommunityUrl
//
// Description:
//
//   Parses steam community URL from its serialized or user-provided representation.
//
// Parameters:
//
// - identifier (string):
//   The Steam identifier supplied by the user or a normalized parser stage.
//
// Returns:
//
//   The resulting ParsedSteamIdentifier value.
//
//---------------------------------------------------------------------------------------------------------------------

function parseSteamCommunityUrl ( identifier: string ): ParsedSteamIdentifier
{
    let url: URL;

    try
    {
        url = new URL ( identifier );
    }
    catch
    {
        return invalidIdentifier ();
    }

    if (
        url.protocol !== 'https:'
        || !STEAM_COMMUNITY_HOSTNAMES.has ( url.hostname.toLowerCase () )
        || url.port !== ''
        || url.username !== ''
        || url.password !== ''
        || url.search !== ''
        || url.hash !== ''
    )
    {
        return invalidIdentifier ();
    }

    const pathSegments = url.pathname.split ( '/' ).filter ( segment => segment.length > 0 );

    if ( pathSegments.length !== 2 )
    {
        return invalidIdentifier ();
    }

    const routeName         = pathSegments [ 0 ]?.toLowerCase ();
    const encodedIdentifier = pathSegments [ 1 ];
    let decodedIdentifier: string;

    if ( encodedIdentifier === undefined )
    {
        return invalidIdentifier ();
    }

    try
    {
        decodedIdentifier = decodeURIComponent ( encodedIdentifier );
    }
    catch
    {
        return invalidIdentifier ();
    }

    if ( routeName === 'profiles' && STEAM_ID_PATTERN.test ( decodedIdentifier ) )
    {
        return (
            { kind: 'steamId', steamId: decodedIdentifier }
        );
    }

    if ( routeName === 'id' && isValidVanityIdentifier ( decodedIdentifier ) )
    {
        return (
            { kind: 'vanity', vanityIdentifier: decodedIdentifier }
        );
    }

    return invalidIdentifier ();
}

//---------------------------------------------------------------------------------------------------------------------
// Function: parseSteamIdentifier
//
// Description:
//
//   Parses steam identifier from its serialized or user-provided representation.
//
// Parameters:
//
// - value (string):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting ParsedSteamIdentifier value.
//
//---------------------------------------------------------------------------------------------------------------------

export function parseSteamIdentifier ( value: string ): ParsedSteamIdentifier
{
    const identifier = value.trim ();

    if ( identifier.length === 0 || identifier.length > MAXIMUM_IDENTIFIER_LENGTH )
    {
        return invalidIdentifier ();
    }

    if ( STEAM_ID_PATTERN.test ( identifier ) )
    {
        return (
            { kind: 'steamId', steamId: identifier }
        );
    }

    if ( /^https?:\/\//i.test ( identifier ) )
    {
        return parseSteamCommunityUrl ( identifier );
    }

    if ( /^\d+$/.test ( identifier ) || !isValidVanityIdentifier ( identifier ) )
    {
        return invalidIdentifier ();
    }

    return (
        { kind: 'vanity', vanityIdentifier: identifier }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSteamIdentifierCacheKey
//
// Description:
//
//   Creates steam identifier cache key from the supplied inputs.
//
// Parameters:
//
// - identifier (ParsedSteamIdentifier):
//   The Steam identifier supplied by the user or a normalized parser stage.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function createSteamIdentifierCacheKey ( identifier: ParsedSteamIdentifier ): string
{
    if ( identifier.kind === 'steamId' )
    {
        return `steam-id/${identifier.steamId}`;
    }

    return `vanity/${identifier.vanityIdentifier.toLowerCase ()}`;
}

//---------------------------------------------------------------------------------------------------------------------
// Steam response validation.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isResolveVanityUrlResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the resolve vanity URL response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the resolve vanity URL response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isResolveVanityUrlResponse ( value: unknown ): value is ResolveVanityUrlResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.response ) )
    {
        return false;
    }

    const response = value.response;

    return typeof response.success === 'number'
        && ( response.message === undefined || typeof response.message === 'string' )
        && ( response.steamid === undefined || typeof response.steamid === 'string' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isSteamPlayerSummary
//
// Description:
//
//   Determines whether the supplied value satisfies the steam player summary contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the steam player summary contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isSteamPlayerSummary ( value: unknown ): value is SteamPlayerSummary
{
    if ( !isJsonObject ( value ) )
    {
        return false;
    }

    return typeof value.steamid === 'string'
        && ( value.communityvisibilitystate === undefined
            || typeof value.communityvisibilitystate === 'number' )
        && ( value.personaname === undefined || typeof value.personaname === 'string' )
        && ( value.profileurl === undefined || typeof value.profileurl === 'string' )
        && ( value.avatar === undefined || typeof value.avatar === 'string' )
        && ( value.avatarmedium === undefined || typeof value.avatarmedium === 'string' )
        && ( value.avatarfull === undefined || typeof value.avatarfull === 'string' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGetPlayerSummariesResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the get player summaries response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the get player summaries response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGetPlayerSummariesResponse ( value: unknown ): value is GetPlayerSummariesResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.response ) || !Array.isArray ( value.response.players ) )
    {
        return false;
    }

    return value.response.players.every ( isSteamPlayerSummary );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeProfileUrl
//
// Description:
//
//   Normalizes profile URL into the application contract.
//
// Parameters:
//
// - value (string):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeProfileUrl ( value: string ): string
{
    let url: URL;

    try
    {
        url = new URL ( value );
    }
    catch
    {
        throw new SteamInvalidResponseError ();
    }

    if ( url.protocol !== 'https:' || !STEAM_COMMUNITY_HOSTNAMES.has ( url.hostname.toLowerCase () ) )
    {
        throw new SteamInvalidResponseError ();
    }

    return url.href;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeAvatarUrl
//
// Description:
//
//   Normalizes avatar URL into the application contract.
//
// Parameters:
//
// - values (Array<string | undefined>):
//   The values to validate, normalize, or store.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeAvatarUrl ( ...values: Array<string | undefined> ): string | null
{
    for ( const value of values )
    {
        if ( value === undefined || value.length === 0 )
        {
            continue;
        }

        try
        {
            const url = new URL ( value );

            if ( url.protocol === 'https:' )
            {
                return url.href;
            }
        }
        catch
        {
            // A missing or invalid avatar is optional metadata and becomes the documented null fallback.
        }
    }

    return null;
}

//---------------------------------------------------------------------------------------------------------------------
// Endpoint adapters.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: resolveVanityIdentifier
//
// Description:
//
//   Resolves vanity identifier into the normalized value required by its caller.
//
// Parameters:
//
// - vanityIdentifier (string):
//   The vanity identifier used by the operation.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<string> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function resolveVanityIdentifier
(
    vanityIdentifier: string,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<string>
{
    const response = await requestSteamJson (
        {
            interfaceName: 'ISteamUser',
            methodName:    'ResolveVanityURL',
            parameters:
            {
                format:    'json',
                url_type:  1,
                vanityurl: vanityIdentifier,
            },
            validate:      isResolveVanityUrlResponse,
            version:       1,
        },
        {
            apiKey,
            fetchFunction,
        },
    );

    if ( response.response.success !== 1 || response.response.steamid === undefined )
    {
        throw new SteamUserNotFoundError ();
    }

    if ( !STEAM_ID_PATTERN.test ( response.response.steamid ) )
    {
        throw new SteamInvalidResponseError ();
    }

    return response.response.steamid;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getPlayerSummary
//
// Description:
//
//   Retrieves player summary through the appropriate application boundary.
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
//   The resulting Promise<UserSummary> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function getPlayerSummary
(
    steamId: string,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<UserSummary>
{
    const response = await requestSteamJson (
        {
            interfaceName: 'ISteamUser',
            methodName:    'GetPlayerSummaries',
            parameters:
            {
                format:   'json',
                steamids: steamId,
            },
            validate:      isGetPlayerSummariesResponse,
            version:       2,
        },
        {
            apiKey,
            fetchFunction,
        },
    );
    const player = response.response.players.find ( candidate => candidate.steamid === steamId );

    if ( player === undefined )
    {
        throw new SteamUserNotFoundError ();
    }

    if (
        player.communityvisibilitystate !== undefined
        && player.communityvisibilitystate !== 3
    )
    {
        throw new SteamProfilePrivateError ();
    }

    if ( typeof player.personaname !== 'string' || typeof player.profileurl !== 'string' )
    {
        throw new SteamInvalidResponseError ();
    }

    const personaName = player.personaname.trim ();

    if ( personaName.length === 0 )
    {
        throw new SteamInvalidResponseError ();
    }

    return (
        {
            avatarUrl:   normalizeAvatarUrl ( player.avatarfull, player.avatarmedium, player.avatar ),
            personaName,
            profileUrl:  normalizeProfileUrl ( player.profileurl ),
            steamId:     player.steamid,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: resolveSteamUser
//
// Description:
//
//   Resolves steam user into the normalized value required by its caller.
//
// Parameters:
//
// - parsedIdentifier (ParsedSteamIdentifier):
//   The parsed identifier used by the operation.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<UserSummary> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function resolveSteamUser
(
    parsedIdentifier: ParsedSteamIdentifier,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<UserSummary>
{
    const steamId = parsedIdentifier.kind === 'steamId'
        ? parsedIdentifier.steamId
        : await resolveVanityIdentifier ( parsedIdentifier.vanityIdentifier, apiKey, fetchFunction );

    return getPlayerSummary ( steamId, apiKey, fetchFunction );
}
