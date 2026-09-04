//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Steam achievement endpoint adapters. Shared schema and rarity data plus user-specific player state are normalized
//   before raw Steam response structures can enter persistent cache or cross the browser-facing application boundary.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import type {
    AchievementDefinition,
    AchievementItemProgressDefinition,
    AchievementItemProgressSchema,
    AchievementSchema,
    GlobalAchievementPercentage,
    GlobalAchievementRarity,
    PlayerAchievementItemProgress,
    PlayerAchievementState,
} from '../model/api';
import { isJsonObject, requestSteamJson, SteamRequestFailedError } from './client';
import { SteamGameDetailsPrivateError, validateSteamId } from './library';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const DECIMAL_PERCENTAGE_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const FORBIDDEN                  = 403;
const MAXIMUM_APP_ID             = 4_294_967_295;
const PROGRESS_TYPE_FLOAT        = 2;
const PROGRESS_TYPE_INTEGER      = 1;
const UNAUTHORIZED               = 401;

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

interface GetSchemaForGameResponse
{
    game:
    {
        availableGameStats?:
        {
            achievements?: unknown [];
        };
    };
}

interface GetPlayerAchievementsResponse
{
    playerstats:
    {
        achievements?: unknown [];
        success?: boolean;
    };
}

interface GetGlobalAchievementPercentagesResponse
{
    achievementpercentages:
    {
        achievements?: unknown [];
    };
}

interface GetGameAchievementsResponse
{
    response:
    {
        achievements?: unknown [];
    };
}

interface GetUserAchievementsResponse
{
    response:
    {
        achievements?: unknown [];
    };
}

//---------------------------------------------------------------------------------------------------------------------
// Response validation and normalization.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isGetSchemaForGameResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the get schema for game response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the get schema for game response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGetSchemaForGameResponse ( value: unknown ): value is GetSchemaForGameResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.game ) )
    {
        return false;
    }

    const availableGameStats = value.game.availableGameStats;

    if ( availableGameStats === undefined )
    {
        return true;
    }

    return isJsonObject ( availableGameStats )
        && ( availableGameStats.achievements === undefined || Array.isArray ( availableGameStats.achievements ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGetPlayerAchievementsResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the get player achievements response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the get player achievements response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGetPlayerAchievementsResponse ( value: unknown ): value is GetPlayerAchievementsResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.playerstats ) )
    {
        return false;
    }

    const playerStatistics = value.playerstats;

    return ( playerStatistics.achievements === undefined || Array.isArray ( playerStatistics.achievements ) )
        && ( playerStatistics.success === undefined || typeof playerStatistics.success === 'boolean' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGetGlobalAchievementPercentagesResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the get global achievement percentages response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the get global achievement percentages response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGetGlobalAchievementPercentagesResponse
(
    value: unknown,
): value is GetGlobalAchievementPercentagesResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.achievementpercentages ) )
    {
        return false;
    }

    const achievementPercentages = value.achievementpercentages;

    return achievementPercentages.achievements === undefined
        || Array.isArray ( achievementPercentages.achievements );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGetGameAchievementsResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the get game achievements response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the get game achievements response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGetGameAchievementsResponse ( value: unknown ): value is GetGameAchievementsResponse
{
    return isJsonObject ( value )
        && isJsonObject ( value.response )
        && ( value.response.achievements === undefined || Array.isArray ( value.response.achievements ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isGetUserAchievementsResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the get user achievements response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the get user achievements response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isGetUserAchievementsResponse ( value: unknown ): value is GetUserAchievementsResponse
{
    return isJsonObject ( value )
        && isJsonObject ( value.response )
        && ( value.response.achievements === undefined || Array.isArray ( value.response.achievements ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeOptionalText
//
// Description:
//
//   Normalizes optional text into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeOptionalText ( value: unknown ): string | null
{
    if ( typeof value !== 'string' )
    {
        return null;
    }

    const normalizedValue = value.trim ();

    return normalizedValue.length > 0 ? normalizedValue : null;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeImageUrl
//
// Description:
//
//   Normalizes image URL into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeImageUrl ( value: unknown ): string | null
{
    if ( typeof value !== 'string' )
    {
        return null;
    }

    try
    {
        const url = new URL ( value );

        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString () : null;
    }
    catch
    {
        return null;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeAchievementDefinition
//
// Description:
//
//   Normalizes achievement definition into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting AchievementDefinition | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeAchievementDefinition ( value: unknown ): AchievementDefinition | null
{
    if ( !isJsonObject ( value ) )
    {
        return null;
    }

    const apiName = normalizeOptionalText ( value.name );

    if ( apiName === null )
    {
        return null;
    }

    return (
        {
            apiName,
            description: normalizeOptionalText ( value.description ),
            iconGrayUrl: normalizeImageUrl ( value.icongray ),
            iconUrl:     normalizeImageUrl ( value.icon ),
            name:        normalizeOptionalText ( value.displayName ) ?? apiName,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizePlayerAchievementState
//
// Description:
//
//   Normalizes player achievement state into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting PlayerAchievementState | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizePlayerAchievementState ( value: unknown ): PlayerAchievementState | null
{
    if ( !isJsonObject ( value ) )
    {
        return null;
    }

    const apiName  = normalizeOptionalText ( value.apiname );
    const achieved = value.achieved === 1 || value.achieved === true;

    if ( apiName === null || ( value.achieved !== 0 && value.achieved !== 1
        && value.achieved !== false && value.achieved !== true ) )
    {
        return null;
    }

    const unlockTime = achieved
        && typeof value.unlocktime === 'number'
        && Number.isSafeInteger ( value.unlocktime )
        && value.unlocktime > 0
            ? value.unlocktime
            : null;

    return (
        {
            achieved,
            apiName,
            unlockTime,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeGlobalAchievementPercentage
//
// Description:
//
//   Normalizes global achievement percentage into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting GlobalAchievementPercentage | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeGlobalAchievementPercentage ( value: unknown ): GlobalAchievementPercentage | null
{
    if ( !isJsonObject ( value ) )
    {
        return null;
    }

    const apiName = normalizeOptionalText ( value.name );
    let globalPercentage: number;

    if ( typeof value.percent === 'number' )
    {
        globalPercentage = value.percent;
    }
    else if ( typeof value.percent === 'string' )
    {
        const percentageText = value.percent.trim ();

        if ( !DECIMAL_PERCENTAGE_PATTERN.test ( percentageText ) )
        {
            return null;
        }

        globalPercentage = Number ( percentageText );
    }
    else
    {
        return null;
    }

    if (
        apiName === null
        || !Number.isFinite ( globalPercentage )
        || globalPercentage < 0
        || globalPercentage > 100
    )
    {
        return null;
    }

    return (
        { apiName, globalPercentage }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeProgressNumber
//
// Description:
//
//   Normalizes progress number into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting number | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeProgressNumber ( value: unknown ): number | null
{
    return typeof value === 'number' && Number.isFinite ( value ) ? value : null;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeAchievementItemProgressDefinition
//
// Description:
//
//   Normalizes achievement item progress definition into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting AchievementItemProgressDefinition | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeAchievementItemProgressDefinition
(
    value: unknown,
): AchievementItemProgressDefinition | null
{
    if ( !isJsonObject ( value ) )
    {
        return null;
    }

    const apiName     = normalizeOptionalText ( value.internal_name );
    const internalKey = value.internal_key;
    const progressType = value.progress_type;
    const minimum = normalizeProgressNumber (
        progressType === PROGRESS_TYPE_FLOAT ? value.min_progress_float : value.min_progress_int,
    ) ?? 0;
    const target = normalizeProgressNumber (
        progressType === PROGRESS_TYPE_FLOAT ? value.max_progress_float : value.max_progress_int,
    );

    if (
        apiName === null
        || !Number.isSafeInteger ( internalKey )
        || ( internalKey as number ) < 0
        || ( progressType !== PROGRESS_TYPE_INTEGER && progressType !== PROGRESS_TYPE_FLOAT )
        || target === null
        || target <= minimum
        || target <= 1
    )
    {
        return null;
    }

    return (
        {
            apiName,
            internalKey: internalKey as number,
            minimum,
            target,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizePlayerAchievementItemProgress
//
// Description:
//
//   Normalizes player achievement item progress into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting PlayerAchievementItemProgress | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizePlayerAchievementItemProgress ( value: unknown ): PlayerAchievementItemProgress | null
{
    if ( !isJsonObject ( value ) )
    {
        return null;
    }

    const internalKey = value.internal_key;

    if ( typeof internalKey !== 'number' || !Number.isSafeInteger ( internalKey ) || internalKey < 0 )
    {
        return null;
    }

    const current = normalizeProgressNumber ( value.progress_int )
        ?? normalizeProgressNumber ( value.progress_float );

    if ( current === null )
    {
        return null;
    }

    return (
        {
            current,
            internalKey,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: validateAppId
//
// Description:
//
//   Validates APPID before it crosses the application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function validateAppId ( appId: number ): void
{
    if ( !Number.isSafeInteger ( appId ) || appId < 1 || appId > MAXIMUM_APP_ID )
    {
        throw new RangeError ( 'A positive 32-bit Steam AppID is required.' );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeAchievementSchema
//
// Description:
//
//   Normalizes achievement schema into the application contract.
//
// Parameters:
//
// - values (readonly unknown []):
//   The values to validate, normalize, or store.
//
// Returns:
//
//   The resulting AchievementSchema value.
//
//---------------------------------------------------------------------------------------------------------------------

export function normalizeAchievementSchema ( values: readonly unknown [] ): AchievementSchema
{
    const achievementsByApiName = new Map<string, AchievementDefinition> ();

    for ( const value of values )
    {
        const achievement = normalizeAchievementDefinition ( value );

        if ( achievement !== null && !achievementsByApiName.has ( achievement.apiName ) )
        {
            achievementsByApiName.set ( achievement.apiName, achievement );
        }
    }

    return (
        { achievements: Array.from ( achievementsByApiName.values () ) }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizePlayerAchievementStates
//
// Description:
//
//   Normalizes player achievement states into the application contract.
//
// Parameters:
//
// - values (readonly unknown []):
//   The values to validate, normalize, or store.
//
// Returns:
//
//   The resulting PlayerAchievementState [] value.
//
//---------------------------------------------------------------------------------------------------------------------

export function normalizePlayerAchievementStates ( values: readonly unknown [] ): PlayerAchievementState []
{
    const statesByApiName = new Map<string, PlayerAchievementState> ();

    for ( const value of values )
    {
        const state = normalizePlayerAchievementState ( value );

        if ( state !== null && !statesByApiName.has ( state.apiName ) )
        {
            statesByApiName.set ( state.apiName, state );
        }
    }

    return Array.from ( statesByApiName.values () );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeGlobalAchievementRarity
//
// Description:
//
//   Normalizes global achievement rarity into the application contract.
//
// Parameters:
//
// - values (readonly unknown []):
//   The values to validate, normalize, or store.
//
// Returns:
//
//   The resulting GlobalAchievementRarity value.
//
//---------------------------------------------------------------------------------------------------------------------

export function normalizeGlobalAchievementRarity ( values: readonly unknown [] ): GlobalAchievementRarity
{
    const percentagesByApiName = new Map<string, GlobalAchievementPercentage> ();

    for ( const value of values )
    {
        const percentage = normalizeGlobalAchievementPercentage ( value );

        if ( percentage !== null && !percentagesByApiName.has ( percentage.apiName ) )
        {
            percentagesByApiName.set ( percentage.apiName, percentage );
        }
    }

    return (
        { achievements: Array.from ( percentagesByApiName.values () ) }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeAchievementItemProgressSchema
//
// Description:
//
//   Normalizes achievement item progress schema into the application contract.
//
// Parameters:
//
// - values (readonly unknown []):
//   The values to validate, normalize, or store.
//
// Returns:
//
//   The resulting AchievementItemProgressSchema value.
//
//---------------------------------------------------------------------------------------------------------------------

export function normalizeAchievementItemProgressSchema
(
    values: readonly unknown [],
): AchievementItemProgressSchema
{
    const definitionsByApiName = new Map<string, AchievementItemProgressDefinition> ();

    for ( const value of values )
    {
        const definition = normalizeAchievementItemProgressDefinition ( value );

        if ( definition !== null && !definitionsByApiName.has ( definition.apiName ) )
        {
            definitionsByApiName.set ( definition.apiName, definition );
        }
    }

    return (
        { achievements: Array.from ( definitionsByApiName.values () ) }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizePlayerAchievementItemProgressStates
//
// Description:
//
//   Normalizes player achievement item progress states into the application contract.
//
// Parameters:
//
// - values (readonly unknown []):
//   The values to validate, normalize, or store.
//
// Returns:
//
//   The resulting PlayerAchievementItemProgress [] value.
//
//---------------------------------------------------------------------------------------------------------------------

export function normalizePlayerAchievementItemProgressStates
(
    values: readonly unknown [],
): PlayerAchievementItemProgress []
{
    const statesByInternalKey = new Map<number, PlayerAchievementItemProgress> ();

    for ( const value of values )
    {
        const state = normalizePlayerAchievementItemProgress ( value );

        if ( state !== null && !statesByInternalKey.has ( state.internalKey ) )
        {
            statesByInternalKey.set ( state.internalKey, state );
        }
    }

    return Array.from ( statesByInternalKey.values () );
}

//---------------------------------------------------------------------------------------------------------------------
// Endpoint adapter.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: getAchievementSchema
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

export async function getAchievementSchema
(
    appId: number,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<AchievementSchema>
{
    validateAppId ( appId );

    const response = await requestSteamJson (
        {
            interfaceName: 'ISteamUserStats',
            methodName:    'GetSchemaForGame',
            parameters:
            {
                appid: appId,
                l:     'english',
            },
            validate: isGetSchemaForGameResponse,
            version:  2,
        },
        {
            apiKey,
            fetchFunction,
        },
    );
    const achievementValues = response.game.availableGameStats?.achievements ?? [];

    return normalizeAchievementSchema ( achievementValues );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getPlayerAchievements
//
// Description:
//
//   Retrieves player achievements through the appropriate application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<PlayerAchievementState []> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function getPlayerAchievements
(
    steamId: string,
    appId: number,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<PlayerAchievementState []>
{
    validateSteamId ( steamId );
    validateAppId ( appId );

    let response: GetPlayerAchievementsResponse;

    try
    {
        response = await requestSteamJson (
            {
                interfaceName: 'ISteamUserStats',
                methodName:    'GetPlayerAchievements',
                parameters:
                {
                    appid:   appId,
                    l:       'english',
                    steamid: steamId,
                },
                validate: isGetPlayerAchievementsResponse,
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
        // A privacy change may invalidate player achievements while the short-lived visible-library cache still
        // contains the game's earlier public state. Translate access denial only at this user-data endpoint.

        if (
            error instanceof SteamRequestFailedError
            && ( error.upstreamStatus === UNAUTHORIZED || error.upstreamStatus === FORBIDDEN )
        )
        {
            throw new SteamGameDetailsPrivateError ();
        }

        throw error;
    }

    if ( response.playerstats.success === false )
    {
        throw new SteamGameDetailsPrivateError ();
    }

    return normalizePlayerAchievementStates ( response.playerstats.achievements ?? [] );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getAchievementItemProgressSchema
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

export async function getAchievementItemProgressSchema
(
    appId: number,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<AchievementItemProgressSchema>
{
    validateAppId ( appId );

    const response = await requestSteamJson (
        {
            interfaceName: 'IPlayerService',
            methodName:    'GetGameAchievements',
            parameters:
            {
                input_json: JSON.stringify (
                    {
                        appid:     appId,
                        hash_only: false,
                        language:  'english',
                    },
                ),
            },
            validate: isGetGameAchievementsResponse,
            version:  1,
        },
        {
            apiKey,
            fetchFunction,
        },
    );

    return normalizeAchievementItemProgressSchema ( response.response.achievements ?? [] );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getPlayerAchievementItemProgress
//
// Description:
//
//   Retrieves player achievement item progress through the appropriate application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The resulting Promise<PlayerAchievementItemProgress []> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function getPlayerAchievementItemProgress
(
    steamId: string,
    appId: number,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<PlayerAchievementItemProgress []>
{
    validateSteamId ( steamId );
    validateAppId ( appId );

    const response = await requestSteamJson (
        {
            interfaceName: 'IPlayerService',
            methodName:    'GetUserAchievements',
            parameters:
            {
                input_json: JSON.stringify (
                    {
                        appid: appId,
                        steamid: steamId,
                    },
                ),
            },
            validate: isGetUserAchievementsResponse,
            version:  1,
        },
        {
            apiKey,
            fetchFunction,
        },
    );

    return normalizePlayerAchievementItemProgressStates ( response.response.achievements ?? [] );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getGlobalAchievementRarity
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

export async function getGlobalAchievementRarity
(
    appId: number,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
): Promise<GlobalAchievementRarity>
{
    validateAppId ( appId );

    const response = await requestSteamJson (
        {
            interfaceName: 'ISteamUserStats',
            methodName:    'GetGlobalAchievementPercentagesForApp',
            parameters:
            {
                gameid: appId,
            },
            validate: isGetGlobalAchievementPercentagesResponse,
            version:  2,
        },
        {
            apiKey,
            fetchFunction,
        },
    );

    return normalizeGlobalAchievementRarity ( response.achievementpercentages.achievements ?? [] );
}
