//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/error-view.js
//
// Description:
//   Context-aware presentation for normalized application errors and optional selected-game degradation. Stable API
//   codes remain the decision boundary; raw upstream details never become browser copy.
//---------------------------------------------------------------------------------------------------------------------

const ERROR_MESSAGES =
{
    STEAM_PROFILE_PRIVATE:
        'This Steam profile is not public. In Steam, open Profile > Edit Profile > Privacy Settings, set My Profile '
            + 'and Game Details to Public, then try again.',
    STEAM_GAME_DETAILS_PRIVATE:
        "This user's Steam Game Details are not publicly visible. Try another user or, if this is your profile, open "
            + 'Profile > Edit Profile > Privacy Settings, set Game Details to Public, then try again.',
    STEAM_GAME_HAS_NO_ACHIEVEMENTS:
        'The selected game does not expose Steam achievements. Choose another game.',
    STEAM_GAME_NOT_VISIBLE:
        'The selected game is no longer visible in this Steam library. Choose another game or change user.',
    STEAM_LIBRARY_EMPTY:
        'No publicly visible Steam games were found for this user. Check their Game Details privacy or try another '
            + 'user.',
    STEAM_REQUEST_TIMEOUT:
        'Steam did not respond in time. Try again in a few minutes.',
    STEAM_UNAVAILABLE:
        'Steam is currently unavailable. Try again in a few minutes.',
    STEAM_USER_IDENTIFIER_INVALID:
        'Enter a valid SteamID64, Steam Community profile URL, or custom Steam Community URL name.',
    STEAM_USER_NOT_FOUND:
        'No Steam user was found for that identifier. Check the SteamID or profile URL and try again.',
};

const STEAM_SERVICE_ERROR_CODES = new Set
(
    [
        'STEAM_INVALID_RESPONSE',
        'STEAM_REQUEST_FAILED',
    ],
);

//---------------------------------------------------------------------------------------------------------------------
// Function: getApplicationErrorMessage
//
// Description:
//
//   Retrieves application error message through the appropriate application boundary.
//
// Parameters:
//
// - error (unknown):
//   The error used by the operation.
//
// Returns:
//
//   The result produced by the get application error message operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function getApplicationErrorMessage ( error )
{
    if ( error !== null && typeof error === 'object' )
    {
        const mappedMessage = ERROR_MESSAGES [ error.code ];

        if ( mappedMessage !== undefined )
        {
            return mappedMessage;
        }

        if ( STEAM_SERVICE_ERROR_CODES.has ( error.code ) )
        {
            return 'Steam returned an unusable response. Try again in a few minutes.';
        }

        if ( typeof error.message === 'string' && error.message.trim ().length > 0 )
        {
            return error.message;
        }
    }

    return 'The application could not complete that request. Try again.';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getRarityAvailabilityMessage
//
// Description:
//
//   Retrieves rarity availability message through the appropriate application boundary.
//
// Parameters:
//
// - selectedGameAchievements (array):
//   The complete normalized selected-game response.
//
// Returns:
//
//   The result produced by the get rarity availability message operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function getRarityAvailabilityMessage ( selectedGameAchievements )
{
    const achievements = selectedGameAchievements.achievements;
    const gameName      = selectedGameAchievements.game.name;
    const missingCount  = achievements.filter ( achievement => achievement.globalPercentage === null ).length;

    if ( missingCount === 0 )
    {
        return `Loaded achievements for ${gameName}.`;
    }

    if ( missingCount === achievements.length )
    {
        return `Loaded achievements for ${gameName}. Global rarity is currently unavailable; `
            + 'achievement data remains usable.';
    }

    const achievementLabel = missingCount === 1 ? 'achievement' : 'achievements';

    return `Loaded achievements for ${gameName}. Global rarity is unavailable for ${missingCount} ${achievementLabel}.`;
}
