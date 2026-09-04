//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/state.js
//
// Description:
//   Small explicit frontend application state. User-dependent values are reset together so an in-flight or failed
//   identity change cannot leave the previous user's game or achievement content presented as current.
//---------------------------------------------------------------------------------------------------------------------

export const applicationState =
{
    activeCard:             'user-id',
    achievements: [],
    discoveryCursor:        null,
    error:                  null,
    gameDiscoveryStatus:    'idle',
    gameRequestNumber:      0,
    games: [],
    loadingState:           'idle',
    resolvedUser:           null,
    selectedAppId:          null,
    selectedGame:           null,
    selectedSort:           'rarity',
    showLockedAchievements: false,
    progress:               null,
    userInput:              '',
    userRequestNumber:      0,
};

//---------------------------------------------------------------------------------------------------------------------
// Function: beginUserResolution
//
// Description:
//
//   Begins user resolution and records the state required by later completion.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - userInput (unknown):
//   The committed Steam identifier text.
//
// Returns:
//
//   The result produced by the begin user resolution operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function beginUserResolution ( state, userInput )
{
    state.activeCard          = 'user-id';
    state.achievements        = [];
    state.discoveryCursor     = null;
    state.error               = null;
    state.gameDiscoveryStatus = 'idle';
    state.gameRequestNumber  += 1;
    state.games               = [];
    state.loadingState        = 'user';
    state.resolvedUser        = null;
    state.selectedAppId       = null;
    state.selectedGame        = null;
    state.progress            = null;
    state.userInput           = userInput;
    state.userRequestNumber  += 1;

    return state.userRequestNumber;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: failUserResolution
//
// Description:
//
//   Records user resolution only when the failure still belongs to the active request.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - error (unknown):
//   The error used by the operation.
//
// Returns:
//
//   The result produced by the fail user resolution operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function failUserResolution ( state, requestNumber, error )
{
    if ( requestNumber !== state.userRequestNumber )
    {
        return false;
    }

    state.error         = error;
    state.loadingState  = 'idle';
    state.resolvedUser = null;

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: completeUserResolution
//
// Description:
//
//   Completes user resolution while rejecting stale asynchronous results.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - user (unknown):
//   The normalized Steam user associated with the operation.
//
// Returns:
//
//   The result produced by the complete user resolution operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function completeUserResolution ( state, requestNumber, user )
{
    if ( requestNumber !== state.userRequestNumber )
    {
        return false;
    }

    state.error         = null;
    state.loadingState  = 'idle';
    state.resolvedUser = user;

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: beginLibraryLoad
//
// Description:
//
//   Begins library load and records the state required by later completion.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// Returns:
//
//   The result produced by the begin library load operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function beginLibraryLoad ( state, requestNumber )
{
    if ( requestNumber !== state.userRequestNumber || state.resolvedUser === null )
    {
        return false;
    }

    state.error         = null;
    state.games         = [];
    state.loadingState  = 'library';
    state.selectedAppId = null;

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: completeLibraryLoad
//
// Description:
//
//   Completes library load while rejecting stale asynchronous results.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - library (unknown):
//   The library used by the operation.
//
// Returns:
//
//   The result produced by the complete library load operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function completeLibraryLoad ( state, requestNumber, library )
{
    if ( requestNumber !== state.userRequestNumber || state.loadingState !== 'library' )
    {
        return false;
    }

    state.activeCard          = 'achievements';
    state.error               = null;
    state.discoveryCursor     = library.discoveryCursor;
    state.gameDiscoveryStatus = library.discoveryCursor === null ? 'complete' : 'pending';
    state.games               = library.games.filter ( game => game.achievementCapability === 'yes' );
    state.loadingState        = 'idle';

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: completeGameDiscoveryBatch
//
// Description:
//
//   Completes game discovery batch while rejecting stale asynchronous results.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - discovery (unknown):
//   The discovery used by the operation.
//
// Returns:
//
//   The result produced by the complete game discovery batch operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function completeGameDiscoveryBatch ( state, requestNumber, discovery )
{
    if ( requestNumber !== state.userRequestNumber || state.gameDiscoveryStatus !== 'pending' )
    {
        return false;
    }

    const gamesByAppId = new Map ( state.games.map ( game => [ game.appId, game ] ) );

    for ( const game of discovery.games )
    {
        gamesByAppId.set ( game.appId, game );
    }

    state.discoveryCursor     = discovery.discoveryCursor;
    state.error               = null;
    state.gameDiscoveryStatus = discovery.discoveryCursor === null ? 'complete' : 'pending';
    state.games               = Array.from ( gamesByAppId.values () );

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: failGameDiscovery
//
// Description:
//
//   Records game discovery only when the failure still belongs to the active request.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - error (unknown):
//   The error used by the operation.
//
// Returns:
//
//   The result produced by the fail game discovery operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function failGameDiscovery ( state, requestNumber, error )
{
    if ( requestNumber !== state.userRequestNumber || state.gameDiscoveryStatus !== 'pending' )
    {
        return false;
    }

    state.discoveryCursor     = null;
    state.error               = error;
    state.gameDiscoveryStatus = 'failed';

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: failLibraryLoad
//
// Description:
//
//   Records library load only when the failure still belongs to the active request.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - error (unknown):
//   The error used by the operation.
//
// Returns:
//
//   The result produced by the fail library load operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function failLibraryLoad ( state, requestNumber, error )
{
    if ( requestNumber !== state.userRequestNumber || state.loadingState !== 'library' )
    {
        return false;
    }

    state.discoveryCursor     = null;
    state.error               = error;
    state.gameDiscoveryStatus = 'failed';
    state.games               = [];
    state.loadingState        = 'idle';
    state.selectedAppId       = null;
    state.selectedGame        = null;
    state.progress            = null;

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: clearGameSelection
//
// Description:
//
//   Resets game selection to its initial state.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function clearGameSelection ( state )
{
    state.achievements      = [];
    state.error             = null;
    state.gameRequestNumber += 1;
    state.loadingState      = 'idle';
    state.progress          = null;
    state.selectedAppId     = null;
    state.selectedGame      = null;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: beginGameLoad
//
// Description:
//
//   Begins game load and records the state required by later completion.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - game (unknown):
//   The normalized game associated with the operation.
//
// Returns:
//
//   The result produced by the begin game load operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function beginGameLoad ( state, game )
{
    if ( state.resolvedUser === null )
    {
        return null;
    }

    state.achievements      = [];
    state.error             = null;
    state.gameRequestNumber += 1;
    state.loadingState      = 'achievements';
    state.progress          = null;
    state.selectedAppId     = game.appId;
    state.selectedGame      = game;

    return state.gameRequestNumber;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: completeGameLoad
//
// Description:
//
//   Completes game load while rejecting stale asynchronous results.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - selectedGameAchievements (array):
//   The complete normalized selected-game response.
//
// Returns:
//
//   The result produced by the complete game load operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function completeGameLoad ( state, requestNumber, selectedGameAchievements )
{
    if (
        requestNumber !== state.gameRequestNumber
        || state.loadingState !== 'achievements'
        || state.selectedAppId !== selectedGameAchievements.game.appId
    )
    {
        return false;
    }

    state.achievements = selectedGameAchievements.achievements;
    state.error        = null;
    state.loadingState = 'idle';
    state.progress     = selectedGameAchievements.progress;
    state.selectedGame = selectedGameAchievements.game;

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: failGameLoad
//
// Description:
//
//   Records game load only when the failure still belongs to the active request.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - error (unknown):
//   The error used by the operation.
//
// Returns:
//
//   The result produced by the fail game load operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function failGameLoad ( state, requestNumber, error )
{
    if ( requestNumber !== state.gameRequestNumber || state.loadingState !== 'achievements' )
    {
        return false;
    }

    state.achievements = [];
    state.error        = error;
    state.loadingState = 'idle';
    state.progress     = null;

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: setLockedAchievementVisibility
//
// Description:
//
//   Updates locked achievement visibility to reflect the current application state.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - showLockedAchievements (boolean):
//   Whether locked achievements should remain visible.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function setLockedAchievementVisibility ( state, showLockedAchievements )
{
    state.showLockedAchievements = showLockedAchievements;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: resetUserFlow
//
// Description:
//
//   Resets user flow to its initial state.
//
// Parameters:
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function resetUserFlow ( state )
{
    state.achievements           = [];
    state.activeCard             = 'user-id';
    state.discoveryCursor        = null;
    state.error                  = null;
    state.gameDiscoveryStatus    = 'idle';
    state.gameRequestNumber     += 1;
    state.games                  = [];
    state.loadingState           = 'idle';
    state.progress               = null;
    state.resolvedUser           = null;
    state.selectedAppId          = null;
    state.selectedGame           = null;
    state.selectedSort           = 'rarity';
    state.showLockedAchievements = false;
    state.userInput              = '';
    state.userRequestNumber     += 1;
}
