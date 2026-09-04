//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/api-client.js
//
// Description:
//   Browser-side access to the application's normalized API. Steam response structures, authentication, and cache
//   behavior stay behind this boundary.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Normalized API errors.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: ApplicationApiError
//
// Description:
//
//   Represents a normalized application API failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class ApplicationApiError extends Error
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes an ApplicationApiError instance with the supplied dependencies and state.
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
    //-----------------------------------------------------------------------------------------------------------------

    constructor ( code, message, status )
    {
        super ( message );

        this.name   = 'ApplicationApiError';
        this.code   = code;
        this.status = status;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Response validation.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isObject
//
// Description:
//
//   Determines whether the supplied value satisfies the object contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the object contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isObject ( value )
{
    return typeof value === 'object' && value !== null && !Array.isArray ( value );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNormalizedUser
//
// Description:
//
//   Determines whether the supplied value satisfies the normalized user contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the normalized user contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNormalizedUser ( value )
{
    return isObject ( value )
        && ( value.avatarUrl === null || typeof value.avatarUrl === 'string' )
        && typeof value.personaName === 'string'
        && typeof value.profileUrl === 'string'
        && typeof value.steamId === 'string';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNormalizedGame
//
// Description:
//
//   Determines whether the supplied value satisfies the normalized game contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the normalized game contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNormalizedGame ( value )
{
    return isObject ( value )
        && [ 'no', 'unknown', 'yes' ].includes ( value.achievementCapability )
        && ( value.achievementCount === null
            || ( Number.isSafeInteger ( value.achievementCount ) && value.achievementCount >= 0 ) )
        && Number.isSafeInteger ( value.appId )
        && value.appId > 0
        && ( value.bannerUrl === null || typeof value.bannerUrl === 'string' )
        && ( value.iconUrl === null || typeof value.iconUrl === 'string' )
        && typeof value.name === 'string'
        && value.name.length > 0
        && Number.isSafeInteger ( value.playtimeMinutes )
        && value.playtimeMinutes >= 0;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNormalizedLibrary
//
// Description:
//
//   Determines whether the supplied value satisfies the normalized library contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the normalized library contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNormalizedLibrary ( value )
{
    return isObject ( value )
        && ( value.discoveryCursor === null || typeof value.discoveryCursor === 'string' )
        && Array.isArray ( value.games )
        && value.games.length > 0
        && value.games.every ( isNormalizedGame );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNormalizedDiscovery
//
// Description:
//
//   Determines whether the supplied value satisfies the normalized discovery contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the normalized discovery contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNormalizedDiscovery ( value )
{
    return isObject ( value )
        && ( value.discoveryCursor === null || typeof value.discoveryCursor === 'string' )
        && Array.isArray ( value.games )
        && value.games.every ( game => isNormalizedGame ( game ) && game.achievementCapability === 'yes' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNormalizedAchievement
//
// Description:
//
//   Determines whether the supplied value satisfies the normalized achievement contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the normalized achievement contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNormalizedAchievement ( value )
{
    const hasValidItemProgress = value?.progress === null
        || ( isObject ( value?.progress )
            && Number.isFinite ( value.progress.current )
            && Number.isFinite ( value.progress.minimum )
            && value.progress.current >= value.progress.minimum
            && Number.isFinite ( value.progress.target )
            && value.progress.target > 1
            && value.progress.target > value.progress.minimum
            && value.progress.current <= value.progress.target );

    return isObject ( value )
        && typeof value.achieved === 'boolean'
        && typeof value.apiName === 'string'
        && value.apiName.length > 0
        && ( value.description === null || typeof value.description === 'string' )
        && ( value.globalPercentage === null
            || ( Number.isFinite ( value.globalPercentage )
                && value.globalPercentage >= 0
                && value.globalPercentage <= 100 ) )
        && ( value.iconGrayUrl === null || typeof value.iconGrayUrl === 'string' )
        && ( value.iconUrl === null || typeof value.iconUrl === 'string' )
        && typeof value.name === 'string'
        && value.name.length > 0
        && hasValidItemProgress
        && ( value.unlockTime === null
            || ( Number.isSafeInteger ( value.unlockTime ) && value.unlockTime > 0 ) )
        && ( value.achieved === true || value.unlockTime === null );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isSelectedGameAchievements
//
// Description:
//
//   Determines whether the supplied value satisfies the selected game achievements contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the selected game achievements contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isSelectedGameAchievements ( value )
{
    if (
        !isObject ( value )
        || !Array.isArray ( value.achievements )
        || !value.achievements.every ( isNormalizedAchievement )
        || !isObject ( value.game )
        || !isObject ( value.progress )
    )
    {
        return false;
    }

    const unlocked           = value.achievements.filter ( achievement => achievement.achieved ).length;
    const expectedPercentage = value.achievements.length === 0
        ? 0
        : unlocked / value.achievements.length * 100;

    return Number.isSafeInteger ( value.game.appId )
        && value.game.appId > 0
        && Array.isArray ( value.game.bannerUrls )
        && value.game.bannerUrls.every ( bannerUrl => typeof bannerUrl === 'string' && bannerUrl.length > 0 )
        && ( value.game.iconUrl === null || typeof value.game.iconUrl === 'string' )
        && Array.isArray ( value.game.libraryLogoUrls )
        && value.game.libraryLogoUrls.every ( logoUrl => typeof logoUrl === 'string' && logoUrl.length > 0 )
        && typeof value.game.name === 'string'
        && value.game.name.length > 0
        && Number.isSafeInteger ( value.progress.total )
        && value.progress.total === value.achievements.length
        && Number.isSafeInteger ( value.progress.unlocked )
        && value.progress.unlocked === unlocked
        && Number.isFinite ( value.progress.percentage )
        && value.progress.percentage >= 0
        && value.progress.percentage <= 100
        && Math.abs ( value.progress.percentage - expectedPercentage ) < Number.EPSILON;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isApplicationErrorBody
//
// Description:
//
//   Determines whether the supplied value satisfies the application error body contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the application error body contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isApplicationErrorBody ( value )
{
    return isObject ( value )
        && isObject ( value.error )
        && typeof value.error.code === 'string'
        && typeof value.error.message === 'string';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: parseResponseBody
//
// Description:
//
//   Parses response body from its serialized or user-provided representation.
//
// Parameters:
//
// - response (unknown):
//   The upstream or application response to validate.
//
// Returns:
//
//   The result produced by the parse response body operation.
//
//---------------------------------------------------------------------------------------------------------------------

async function parseResponseBody ( response )
{
    try
    {
        return await response.json ();
    }
    catch
    {
        throw new ApplicationApiError (
            'APPLICATION_INVALID_RESPONSE',
            'The application returned an invalid response.',
            response.status,
        );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// User API.
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
// - fetchFunction (unknown):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The result produced by the resolve user operation.
//
//---------------------------------------------------------------------------------------------------------------------

export async function resolveUser ( identifier, fetchFunction = fetch )
{
    const encodedIdentifier = encodeURIComponent ( identifier );
    let response;

    try
    {
        response = await fetchFunction (
            `/api/users/${encodedIdentifier}`,
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    }
    catch
    {
        throw new ApplicationApiError (
            'APPLICATION_UNAVAILABLE',
            'The application could not reach the user service.',
            503,
        );
    }

    const responseBody = await parseResponseBody ( response );

    if ( !response.ok )
    {
        if ( isApplicationErrorBody ( responseBody ) )
        {
            throw new ApplicationApiError (
                responseBody.error.code,
                responseBody.error.message,
                response.status,
            );
        }

        throw new ApplicationApiError (
            'APPLICATION_REQUEST_FAILED',
            'The user could not be resolved.',
            response.status,
        );
    }

    if ( !isNormalizedUser ( responseBody ) )
    {
        throw new ApplicationApiError (
            'APPLICATION_INVALID_RESPONSE',
            'The application returned an invalid response.',
            response.status,
        );
    }

    return responseBody;
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
// - fetchFunction (unknown):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The result produced by the retrieve visible games operation.
//
//---------------------------------------------------------------------------------------------------------------------

export async function retrieveVisibleGames ( steamId, fetchFunction = fetch )
{
    let response;

    try
    {
        response = await fetchFunction (
            `/api/users/${encodeURIComponent ( steamId )}/games`,
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    }
    catch
    {
        throw new ApplicationApiError (
            'APPLICATION_UNAVAILABLE',
            'The application could not reach the game-library service.',
            503,
        );
    }

    const responseBody = await parseResponseBody ( response );

    if ( !response.ok )
    {
        if ( isApplicationErrorBody ( responseBody ) )
        {
            throw new ApplicationApiError (
                responseBody.error.code,
                responseBody.error.message,
                response.status,
            );
        }

        throw new ApplicationApiError (
            'APPLICATION_REQUEST_FAILED',
            'The visible Steam library could not be retrieved.',
            response.status,
        );
    }

    if ( !isNormalizedLibrary ( responseBody ) )
    {
        throw new ApplicationApiError (
            'APPLICATION_INVALID_RESPONSE',
            'The application returned an invalid response.',
            response.status,
        );
    }

    return responseBody;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: discoverAchievementGames
//
// Description:
//
//   Discovers achievement games in a bounded batch and returns continuation state.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - cursor (unknown):
//   The opaque continuation cursor supplied by the previous discovery response.
//
// - fetchFunction (unknown):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The result produced by the discover achievement games operation.
//
//---------------------------------------------------------------------------------------------------------------------

export async function discoverAchievementGames ( steamId, cursor, fetchFunction = fetch )
{
    const query = new URLSearchParams ( { cursor } );
    let response;

    try
    {
        response = await fetchFunction (
            `/api/users/${encodeURIComponent ( steamId )}/games/discover?${query.toString ()}`,
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    }
    catch
    {
        throw new ApplicationApiError (
            'APPLICATION_UNAVAILABLE',
            'The application could not continue game discovery.',
            503,
        );
    }

    const responseBody = await parseResponseBody ( response );

    if ( !response.ok )
    {
        if ( isApplicationErrorBody ( responseBody ) )
        {
            throw new ApplicationApiError (
                responseBody.error.code,
                responseBody.error.message,
                response.status,
            );
        }

        throw new ApplicationApiError (
            'APPLICATION_REQUEST_FAILED',
            'Game achievement discovery could not continue.',
            response.status,
        );
    }

    if ( !isNormalizedDiscovery ( responseBody ) )
    {
        throw new ApplicationApiError (
            'APPLICATION_INVALID_RESPONSE',
            'The application returned an invalid response.',
            response.status,
        );
    }

    return responseBody;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: retrieveSelectedGameAchievements
//
// Description:
//
//   Retrieves selected game achievements through the appropriate application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - fetchFunction (unknown):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   The result produced by the retrieve selected game achievements operation.
//
//---------------------------------------------------------------------------------------------------------------------

export async function retrieveSelectedGameAchievements ( steamId, appId, fetchFunction = fetch )
{
    let response;

    try
    {
        response = await fetchFunction (
            `/api/users/${encodeURIComponent ( steamId )}/games/${encodeURIComponent ( appId )}/achievements`,
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    }
    catch
    {
        throw new ApplicationApiError (
            'APPLICATION_UNAVAILABLE',
            'The application could not retrieve achievements for that game.',
            503,
        );
    }

    const responseBody = await parseResponseBody ( response );

    if ( !response.ok )
    {
        if ( isApplicationErrorBody ( responseBody ) )
        {
            throw new ApplicationApiError (
                responseBody.error.code,
                responseBody.error.message,
                response.status,
            );
        }

        throw new ApplicationApiError (
            'APPLICATION_REQUEST_FAILED',
            'The selected game achievements could not be retrieved.',
            response.status,
        );
    }

    if ( !isSelectedGameAchievements ( responseBody ) )
    {
        throw new ApplicationApiError (
            'APPLICATION_INVALID_RESPONSE',
            'The application returned an invalid response.',
            response.status,
        );
    }

    return responseBody;
}
