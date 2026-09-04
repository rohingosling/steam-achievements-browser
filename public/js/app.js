//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/app.js
//
// Description:
//   Bootstrap. The only module with side effects on load and the place where control events are bound.
//
//   Populates and binds the sort control, binds the locked-achievement visibility control and deliberate User commits,
//   resolves normalized user profiles through the application API, and reports control changes through the shared
//   live region.
//
//   Sorting remains separated from DOM movement, while api-client.js owns normalized HTTP behavior and state.js owns
//   the invariant that every user-dependent value is cleared together before a new identity request begins.
//
// Notes:
//   Loaded as the page's module entry point. Module scripts run after the document has parsed, so no DOMContentLoaded
//   handler is required and the DOM can never be observed half-built.
//---------------------------------------------------------------------------------------------------------------------

import {
    ApplicationApiError,
    discoverAchievementGames,
    resolveUser,
    retrieveSelectedGameAchievements,
    retrieveVisibleGames,
} from './api-client.js';
import { createGameBannerController } from './banner-view.js';
import { getApplicationErrorMessage, getRarityAvailabilityMessage } from './error-view.js';
import { bindUserIdentifierForm, createIdentityView, getResolvedUserDisplayName } from './identity-view.js';
import { applyAchievementOrder, buildAchievementRows, clearAchievementRows } from './list-view.js';
import { bindLockedAchievementControl } from './locked-achievement-control.js';
import { createAchievementProgressController } from './progress-view.js';
import { createScreenshotProgressController } from './screenshot-progress-view.js';
import {
    captureAchievementScreenshot,
    downloadPreparedScreenshotFile,
    ScreenshotExportError,
} from './screenshot-view.js';
import {
    DEFAULT_SORT_FIELD_ID,
    resolveSortField,
    selectAchievementsForDisplay,
    SORT_FIELDS,
} from './sort-fields.js';
import {
    applicationState,
    beginGameLoad,
    beginLibraryLoad,
    beginUserResolution,
    clearGameSelection,
    completeGameLoad,
    completeGameDiscoveryBatch,
    completeLibraryLoad,
    completeUserResolution,
    failGameDiscovery,
    failGameLoad,
    failLibraryLoad,
    failUserResolution,
    resetUserFlow,
} from './state.js';

//---------------------------------------------------------------------------------------------------------------------
// Element identifiers.
//
// The two elements index.html leaves empty for this file to fill: the dropdown, whose options come from the registry,
// and the live region, whose text comes from whichever registry entry was last applied.
//---------------------------------------------------------------------------------------------------------------------

const APPLICATION_STATUS_ELEMENT_ID           = 'application-status';
const APPLICATION_ELEMENT_ID                  = 'application';
const ACHIEVEMENT_CARD_ELEMENT_ID             = 'achievement-card';
const ACHIEVEMENT_HEADING_ELEMENT_ID          = 'achievement-card-title';
const ACHIEVEMENT_LIST_ELEMENT_ID             = 'achievement-list';
const AVATAR_ELEMENT_ID                       = 'user-avatar';
const AVATAR_FRAME_ELEMENT_ID                 = 'user-avatar-frame';
const AVATAR_PLACEHOLDER_ELEMENT_ID           = 'user-avatar-placeholder';
const CHANGE_USER_ELEMENT_ID                  = 'change-user';
const GAME_BANNER_ARTWORK_ELEMENT_ID          = 'game-banner-artwork';
const GAME_BANNER_FALLBACK_ELEMENT_ID         = 'game-banner-fallback';
const GAME_BANNER_FALLBACK_LOGO_ELEMENT_ID    = 'game-banner-fallback-logo';
const GAME_BANNER_FALLBACK_TEXT_ELEMENT_ID    = 'game-banner-fallback-text';
const GAME_BANNER_FALLBACK_VERSION_ELEMENT_ID = 'game-banner-fallback-version';
const GAME_BANNER_IMAGE_ELEMENT_ID            = 'game-banner-image';
const GAME_BANNER_LOGO_ELEMENT_ID             = 'game-banner-logo';
const GAME_CONTROL_ELEMENT_ID                 = 'game-field';
const PROGRESS_BAR_ELEMENT_ID                 = 'achievement-progress-bar';
const PROGRESS_PERCENTAGE_ELEMENT_ID          = 'achievement-progress-percentage';
const PROGRESS_REGION_ELEMENT_ID              = 'achievement-progress';
const PROGRESS_ROSETTE_ELEMENT_ID             = 'achievement-progress-rosette';
const PROGRESS_SUMMARY_ELEMENT_ID             = 'achievement-progress-summary';
const SHOW_LOCKED_CONTROL_ELEMENT_ID          = 'show-locked-achievements';
const SCREENSHOT_CONTROL_ELEMENT_ID           = 'save-achievement-screenshot';
const SCREENSHOT_PROGRESS_LIVE_ELEMENT_ID     = 'screenshot-progress-announcement';
const SCREENSHOT_PROGRESS_BAR_ELEMENT_ID      = 'screenshot-progress-bar';
const SCREENSHOT_PROGRESS_DIALOG_ELEMENT_ID   = 'screenshot-progress-dialog';
const SCREENSHOT_PROGRESS_MESSAGE_ELEMENT_ID  = 'screenshot-progress-message';
const SCREENSHOT_PROGRESS_STAGE_ELEMENT_ID    = 'screenshot-progress-stage';
const SCREENSHOT_PROGRESS_TITLE_ELEMENT_ID    = 'screenshot-progress-title';
const SORT_CONTROL_ELEMENT_ID                 = 'sort-field';
const USER_CARD_ELEMENT_ID                    = 'user-id-card';
const USER_CONTROL_ELEMENT_ID                 = 'user-identifier';
const USER_FORM_ELEMENT_ID                    = 'user-identifier-form';
const USER_STATUS_ELEMENT_ID                  = 'user-card-status';
const PERSONA_NAME_ELEMENT_ID                 = 'achievement-persona-name';
const GAME_NAME_COLLATOR                      = new Intl.Collator ( 'en', { sensitivity: 'base', usage: 'sort' } );

let achievementProgressController = null;
let gameBannerController          = null;
let identityView                  = null;
let isScreenshotExportInProgress  = false;
let pendingScreenshotFiles        = [];
let screenshotProgressController  = null;

//---------------------------------------------------------------------------------------------------------------------
// Function: getIdentityView
//
// Description:
//
//   Retrieves identity view through the appropriate application boundary.
//
// Returns:
//
//   The result produced by the get identity view operation.
//
//---------------------------------------------------------------------------------------------------------------------

function getIdentityView ()
{
    if ( identityView !== null )
    {
        return identityView;
    }

    const elements =
    {
        achievementCard:    document.getElementById ( ACHIEVEMENT_CARD_ELEMENT_ID ),
        achievementHeading: document.getElementById ( ACHIEVEMENT_HEADING_ELEMENT_ID ),
        application:        document.getElementById ( APPLICATION_ELEMENT_ID ),
        avatar:             document.getElementById ( AVATAR_ELEMENT_ID ),
        avatarFrame:        document.getElementById ( AVATAR_FRAME_ELEMENT_ID ),
        avatarPlaceholder:  document.getElementById ( AVATAR_PLACEHOLDER_ELEMENT_ID ),
        personaName:        document.getElementById ( PERSONA_NAME_ELEMENT_ID ),
        userCard:           document.getElementById ( USER_CARD_ELEMENT_ID ),
        userControl:        document.getElementById ( USER_CONTROL_ELEMENT_ID ),
        userStatus:         document.getElementById ( USER_STATUS_ELEMENT_ID ),
    };

    if ( Object.values ( elements ).some ( element => element === null ) )
    {
        return null;
    }

    identityView = createIdentityView ( elements );

    return identityView;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getAchievementProgressController
//
// Description:
//
//   Retrieves achievement progress controller through the appropriate application boundary.
//
// Returns:
//
//   The result produced by the get achievement progress controller operation.
//
//---------------------------------------------------------------------------------------------------------------------

function getAchievementProgressController ()
{
    if ( achievementProgressController !== null )
    {
        return achievementProgressController;
    }

    const percentage  = document.getElementById ( PROGRESS_PERCENTAGE_ELEMENT_ID );
    const progressBar = document.getElementById ( PROGRESS_BAR_ELEMENT_ID );
    const region      = document.getElementById ( PROGRESS_REGION_ELEMENT_ID );
    const rosette     = document.getElementById ( PROGRESS_ROSETTE_ELEMENT_ID );
    const summary     = document.getElementById ( PROGRESS_SUMMARY_ELEMENT_ID );

    if ( percentage === null || progressBar === null || region === null || rosette === null || summary === null )
    {
        return null;
    }

    achievementProgressController = createAchievementProgressController (
        region,
        summary,
        percentage,
        progressBar,
        rosette,
    );

    return achievementProgressController;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: getScreenshotProgressController
//
// Description:
//
//   Retrieves screenshot progress controller through the appropriate application boundary.
//
// Returns:
//
//   The screenshot progress controller, or null when its semantic elements are unavailable.
//
//---------------------------------------------------------------------------------------------------------------------

function getScreenshotProgressController ()
{
    if ( screenshotProgressController !== null )
    {
        return screenshotProgressController;
    }

    const elements =
    {
        announcement: document.getElementById ( SCREENSHOT_PROGRESS_LIVE_ELEMENT_ID ),
        dialog:       document.getElementById ( SCREENSHOT_PROGRESS_DIALOG_ELEMENT_ID ),
        heading:      document.getElementById ( SCREENSHOT_PROGRESS_TITLE_ELEMENT_ID ),
        message:      document.getElementById ( SCREENSHOT_PROGRESS_MESSAGE_ELEMENT_ID ),
        progressBar:  document.getElementById ( SCREENSHOT_PROGRESS_BAR_ELEMENT_ID ),
        stage:        document.getElementById ( SCREENSHOT_PROGRESS_STAGE_ELEMENT_ID ),
    };

    if ( Object.values ( elements ).some ( element => element === null ) )
    {
        return null;
    }

    screenshotProgressController = createScreenshotProgressController ( elements );

    return screenshotProgressController;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: renderAchievementProgress
//
// Description:
//
//   Renders achievement progress into its owning interface region.
//
// Parameters:
//
// - progress (unknown):
//   The normalized achievement progress to render.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function renderAchievementProgress ( progress )
{
    getAchievementProgressController ()?.render ( progress );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: renderAchievementProgressLoading
//
// Description:
//
//   Renders achievement progress loading into its owning interface region.
//
// Parameters:
//
// - message (string):
//   The human-readable status or error message.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function renderAchievementProgressLoading ( message )
{
    getAchievementProgressController ()?.renderLoading ( message );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: renderAchievementProgressStatus
//
// Description:
//
//   Renders achievement progress status into its owning interface region.
//
// Parameters:
//
// - message (string):
//   The human-readable status or error message.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function renderAchievementProgressStatus ( message )
{
    getAchievementProgressController ()?.renderStatus ( message );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: renderNoGameSelectedProgress
//
// Description:
//
//   Renders no game selected progress into its owning interface region.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function renderNoGameSelectedProgress ()
{
    getAchievementProgressController ()?.renderNoGameSelected ();
}

//---------------------------------------------------------------------------------------------------------------------
// Function: updateGameBanner
//
// Description:
//
//   Updates game banner to reflect the current application state.
//
// Parameters:
//
// - game (unknown):
//   The normalized game associated with the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function updateGameBanner ( game )
{
    if ( gameBannerController === null )
    {
        const artwork         = document.getElementById ( GAME_BANNER_ARTWORK_ELEMENT_ID );
        const image           = document.getElementById ( GAME_BANNER_IMAGE_ELEMENT_ID );
        const fallback        = document.getElementById ( GAME_BANNER_FALLBACK_ELEMENT_ID );
        const fallbackLogo    = document.getElementById ( GAME_BANNER_FALLBACK_LOGO_ELEMENT_ID );
        const fallbackText    = document.getElementById ( GAME_BANNER_FALLBACK_TEXT_ELEMENT_ID );
        const fallbackVersion = document.getElementById ( GAME_BANNER_FALLBACK_VERSION_ELEMENT_ID );
        const gameLogo        = document.getElementById ( GAME_BANNER_LOGO_ELEMENT_ID );

        if (
            artwork === null
            || image === null
            || fallback === null
            || fallbackLogo === null
            || fallbackText === null
            || fallbackVersion === null
            || gameLogo === null
        )
        {
            return;
        }

        gameBannerController = createGameBannerController (
            artwork,
            image,
            gameLogo,
            fallback,
            fallbackLogo,
            fallbackText,
            fallbackVersion,
            game =>
            {
                if (
                    applicationState.loadingState === 'idle'
                    && applicationState.selectedAppId === game.appId
                )
                {
                    setApplicationStatus (
                        `Artwork is unavailable for ${game.name}. Showing the game name instead.`,
                    );
                }
            },
        );
    }

    gameBannerController.render ( game );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: populateSortControl
//
// Description:
//
//   Fill the sort control with one option per registry entry, in registry order.
//
//   Generated rather than written into index.html so that the registry stays the single definition of the sort option
//   set: a control built from it cannot offer an order the sort function does not implement, nor omit one it does. The
//   options are appended through a fragment for the same reason the rows are -- one insertion, one layout pass.
//
//   The default field is selected here rather than left to the browser's own "first option wins" behaviour. The two
//   happen to agree today, because the default field is the registry's first entry, but the agreement is a coincidence
//   of ordering rather than a rule, and relying on it would silently desynchronise the control from the applied order
//   the moment the registry is reordered.
//
// Parameters:
//
// - sortControl (unknown):
//   The sort control used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function populateSortControl ( sortControl )
{
    const fragment = document.createDocumentFragment ();

    SORT_FIELDS.forEach ( field =>
    {
        const option = document.createElement ( 'option' );

        option.value       = field.id;
        option.textContent = field.label;

        fragment.appendChild ( option );
    } );

    sortControl.replaceChildren ( fragment );

    sortControl.value = DEFAULT_SORT_FIELD_ID;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: applySortField
//
// Description:
//
//   Order the list by a sort field identifier.
//
//   The single path by which the displayed order changes after selected-game data arrives. The canonical normalized
//   state array is passed every time, never the previously sorted array, so repeated selections remain deterministic.
//
//   The work is synchronous and there is no timer, transition, or animation frame anywhere on this path. The list is
//   reordered in the same task as the change event, so the browser has no opportunity to paint between emptying the
//   list and refilling it, and no intermediate empty or partial list can be seen.
//
// Parameters:
//
// - fieldId (string):
//   The requested achievement sort-field identifier.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function applySortField ( fieldId )
{
    const displayedAchievements = selectAchievementsForDisplay (
        applicationState.achievements,
        fieldId,
        applicationState.showLockedAchievements,
    );

    applyAchievementOrder ( displayedAchievements );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: announceSortOrder
//
// Description:
//
//   Speak the newly applied order into the polite live region.
//
//   A reader who cannot see semantic rows move still needs evidence that the selection took effect. The region carries
//   the registry entry's own sentence, which states what the order means rather than which field was chosen -- `rarest
//   first` rather than `percentage, ascending`.
//
//   Polite rather than assertive, and written after the rows have been moved. The reader is not interrupted mid-word,
//   and the announcement is never made ahead of the thing it describes.
//
//   Called only from the control's change handler, never from start-up. The default order is not a change, and a
//   region that already holds text when the page loads either says nothing or talks over the reader's own first pass
//   across the page, depending on the screen reader -- neither of which is an announcement anyone asked for.
//
// Parameters:
//
// - fieldId (string):
//   The requested achievement sort-field identifier.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function announceSortOrder ( fieldId )
{
    const announcement = document.getElementById ( APPLICATION_STATUS_ELEMENT_ID );

    if ( announcement !== null )
    {
        announcement.textContent = resolveSortField ( fieldId ).announcement;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: announceLockedAchievementVisibility
//
// Description:
//
//   Announces locked achievement visibility through the accessible status region.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function announceLockedAchievementVisibility ()
{
    const unlockedCount = applicationState.achievements.filter ( achievement => achievement.achieved ).length;
    const lockedCount   = applicationState.achievements.length - unlockedCount;
    const message       = applicationState.showLockedAchievements
        ? `Showing ${unlockedCount} unlocked and ${lockedCount} locked achievements.`
        : `Showing ${unlockedCount} unlocked achievements. Locked achievements are hidden.`;

    setApplicationStatus ( message );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: setApplicationStatus
//
// Description:
//
//   Write a user-visible state change to the shared polite live region.
//
// Parameters:
//
// - message (string):
//   The human-readable status or error message.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function setApplicationStatus ( message )
{
    const status = document.getElementById ( APPLICATION_STATUS_ELEMENT_ID );

    if ( status !== null )
    {
        status.textContent = message;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: replaceAchievementListWithStatus
//
// Description:
//
//   Clear every row associated with the previous game or user and replace it with a restrained status message inside
//   the existing list viewport.
//
// Parameters:
//
// - message (string):
//   The human-readable status or error message.
//
// - isError (boolean):
//   The is error used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function replaceAchievementListWithStatus ( message, isError = false )
{
    const achievementList = document.getElementById ( ACHIEVEMENT_LIST_ELEMENT_ID );
    const lockedControl    = document.getElementById ( SHOW_LOCKED_CONTROL_ELEMENT_ID );
    const sortControl      = document.getElementById ( SORT_CONTROL_ELEMENT_ID );

    clearAchievementRows ();

    if ( sortControl !== null )
    {
        sortControl.disabled = true;
    }

    if ( lockedControl !== null )
    {
        lockedControl.disabled = true;
    }

    if ( achievementList === null )
    {
        return;
    }

    const status = document.createElement ( 'li' );

    status.className   = 'achievement-list__status';
    status.textContent = message;

    if ( isError )
    {
        status.classList.add ( 'achievement-list__status--error' );
    }

    achievementList.replaceChildren ( status );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: setGameControlStatus
//
// Description:
//
//   Updates game control status to reflect the current application state.
//
// Parameters:
//
// - gameControl (unknown):
//   The game control used by the operation.
//
// - message (string):
//   The human-readable status or error message.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function setGameControlStatus ( gameControl, message )
{
    const option = document.createElement ( 'option' );

    option.textContent  = message;
    option.value        = '';
    gameControl.disabled = true;
    gameControl.replaceChildren ( option );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: compareGamesByName
//
// Description:
//
//   Compares two values using the deterministic games by name ordering.
//
// Parameters:
//
// - leftGame (unknown):
//   The left game used by the operation.
//
// - rightGame (unknown):
//   The right game used by the operation.
//
// Returns:
//
//   The result produced by the compare games by name operation.
//
//---------------------------------------------------------------------------------------------------------------------

function compareGamesByName ( leftGame, rightGame )
{
    const nameComparison = GAME_NAME_COLLATOR.compare ( leftGame.name, rightGame.name );

    return nameComparison !== 0 ? nameComparison : leftGame.appId - rightGame.appId;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: populateGameControl
//
// Description:
//
//   Populates game control from current normalized application state.
//
// Parameters:
//
// - gameControl (unknown):
//   The game control used by the operation.
//
// - games (array):
//   The normalized games processed by the operation.
//
// - isDiscovering (boolean):
//   The is discovering used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function populateGameControl ( gameControl, games, isDiscovering = false )
{
    const selectedValue = gameControl.value;

    if ( games.length === 0 )
    {
        setGameControlStatus (
            gameControl,
            isDiscovering ? 'Discovering games with achievements…' : 'No achievement games found',
        );

        return;
    }

    const placeholder = document.createElement ( 'option' );

    placeholder.textContent = 'Select a game';
    placeholder.value       = '';

    const options = [ placeholder ];

    for ( const game of [ ...games ].sort ( compareGamesByName ) )
    {
        const option = document.createElement ( 'option' );

        option.textContent = game.name;
        option.value       = String ( game.appId );

        options.push ( option );
    }

    if ( isDiscovering )
    {
        const discoveryOption = document.createElement ( 'option' );

        discoveryOption.disabled    = true;
        discoveryOption.textContent = 'Discovering more games…';
        discoveryOption.value       = '';

        options.push ( discoveryOption );
    }

    gameControl.replaceChildren ( ...options );
    gameControl.disabled = false;

    if ( options.some ( option => option.value === selectedValue ) )
    {
        gameControl.value = selectedValue;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeApplicationError
//
// Description:
//
//   Normalizes application error into the application contract.
//
// Parameters:
//
// - caughtError (unknown):
//   The caught error used by the operation.
//
// - fallbackMessage (string):
//   The fallback message used by the operation.
//
// Returns:
//
//   The result produced by the normalize application error operation.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeApplicationError ( caughtError, fallbackMessage )
{
    const error = caughtError instanceof ApplicationApiError
        ? caughtError
        : new ApplicationApiError ( 'APPLICATION_UNAVAILABLE', fallbackMessage, 503 );

    return new ApplicationApiError ( error.code, getApplicationErrorMessage ( error ), error.status );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: continueGameDiscovery
//
// Description:
//
//   Continues game discovery while the cursor and request ownership remain current.
//
// Parameters:
//
// - user (unknown):
//   The normalized Steam user associated with the operation.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - gameControl (unknown):
//   The game control used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function continueGameDiscovery ( user, requestNumber, gameControl )
{
    while ( applicationState.discoveryCursor !== null )
    {
        const cursor = applicationState.discoveryCursor;

        try
        {
            const discovery = await discoverAchievementGames ( user.steamId, cursor );

            if ( !completeGameDiscoveryBatch ( applicationState, requestNumber, discovery ) )
            {
                return;
            }

            const isDiscovering = applicationState.discoveryCursor !== null;

            populateGameControl ( gameControl, applicationState.games, isDiscovering );

            if ( applicationState.selectedAppId === null )
            {
                renderNoGameSelectedProgress ();
            }

            if ( applicationState.games.length === 0 )
            {
                replaceAchievementListWithStatus (
                    isDiscovering
                        ? 'Discovering games with Steam achievements…'
                        : 'No Steam achievements were found for the publicly visible games in this library.',
                );
            }

            const gameCountLabel = applicationState.games.length === 1 ? 'game' : 'games';
            const statusMessage  = isDiscovering
                ? `Found ${applicationState.games.length} achievement ${gameCountLabel}; discovery is continuing.`
                : `Game discovery complete. Found ${applicationState.games.length} achievement ${gameCountLabel}.`;

            setApplicationStatus ( statusMessage );
        }
        catch ( caughtError )
        {
            const error = normalizeApplicationError (
                caughtError,
                'The application could not continue game achievement discovery.',
            );

            if ( !failGameDiscovery ( applicationState, requestNumber, error ) )
            {
                return;
            }

            populateGameControl ( gameControl, applicationState.games );

            if ( applicationState.games.length === 0 )
            {
                replaceAchievementListWithStatus ( error.message, true );
            }

            setApplicationStatus ( error.message );

            return;
        }
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: loadVisibleLibrary
//
// Description:
//
//   Retrieves visible library through the appropriate application boundary.
//
// Parameters:
//
// - user (unknown):
//   The normalized Steam user associated with the operation.
//
// - requestNumber (number):
//   The monotonic request identifier used to reject stale asynchronous results.
//
// - gameControl (unknown):
//   The game control used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function loadVisibleLibrary ( user, requestNumber, gameControl )
{
    if ( !beginLibraryLoad ( applicationState, requestNumber ) )
    {
        return;
    }

    const displayName = getResolvedUserDisplayName ( user );

    setGameControlStatus ( gameControl, 'Loading visible games…' );
    getIdentityView ()?.renderUserStatus ( `Loading visible Steam games for ${displayName}…` );
    setApplicationStatus ( `Loading visible Steam games for ${displayName}.` );

    try
    {
        const library = await retrieveVisibleGames ( user.steamId );

        if ( !completeLibraryLoad ( applicationState, requestNumber, library ) )
        {
            return;
        }

        const isDiscovering = applicationState.discoveryCursor !== null;

        populateGameControl ( gameControl, applicationState.games, isDiscovering );

        const gameCountLabel = applicationState.games.length === 1 ? 'game' : 'games';
        const loadedGameCount = applicationState.games.length;
        const message         = isDiscovering
            ? `Loaded ${loadedGameCount} cached achievement ${gameCountLabel} for ${displayName}; `
                + 'discovery is continuing.'
            : `Loaded ${loadedGameCount} achievement ${gameCountLabel} for ${displayName}.`;

        const selectionMessage = applicationState.games.length > 0
            ? 'Select a game to continue.'
            : isDiscovering
                ? 'Discovering games with Steam achievements…'
                : 'No Steam achievements were found for the publicly visible games in this library.';

        replaceAchievementListWithStatus ( selectionMessage );
        renderNoGameSelectedProgress ();
        getIdentityView ()?.setUserPending ( false );
        getIdentityView ()?.renderUserStatus ( '' );
        getIdentityView ()?.showAchievementCard ( user );
        setApplicationStatus ( message );

        if ( isDiscovering )
        {
            void continueGameDiscovery ( user, requestNumber, gameControl );
        }
    }
    catch ( caughtError )
    {
        const error = normalizeApplicationError (
            caughtError,
            'The application could not retrieve that Steam library.',
        );

        if ( !failLibraryLoad ( applicationState, requestNumber, error ) )
        {
            return;
        }

        setGameControlStatus ( gameControl, 'Games unavailable' );
        getIdentityView ()?.setUserPending ( false );
        getIdentityView ()?.renderUserStatus ( error.message, true );
        document.getElementById ( USER_CONTROL_ELEMENT_ID )?.setAttribute ( 'aria-invalid', 'true' );
        document.getElementById ( USER_CONTROL_ELEMENT_ID )?.focus ();
        setApplicationStatus ( error.message );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: setUserControlState
//
// Description:
//
//   Reflect user-resolution state on the native input without disabling correction while a request is running.
//
// Parameters:
//
// - userControl (unknown):
//   The Steam identifier input controlled by the form.
//
// - isLoading (boolean):
//   The is loading used by the operation.
//
// - isInvalid (boolean):
//   The is invalid used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function setUserControlState ( userControl, isLoading, isInvalid )
{
    getIdentityView ()?.setUserPending ( isLoading );
    userControl.setAttribute ( 'aria-busy', String ( isLoading ) );
    userControl.setAttribute ( 'aria-invalid', String ( isInvalid ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: commitUserValue
//
// Description:
//
//   Resolve one deliberately submitted User value. Starting the request clears all stale user-dependent display state
//   immediately; request numbers prevent an older response from overwriting a newer committed value.
//
// Parameters:
//
// - userControl (unknown):
//   The Steam identifier input controlled by the form.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function commitUserValue ( userControl )
{
    const userInput = userControl.value.trim ();

    const requestNumber = beginUserResolution ( applicationState, userInput );
    const gameControl   = document.getElementById ( GAME_CONTROL_ELEMENT_ID );
    const sortControl   = document.getElementById ( SORT_CONTROL_ELEMENT_ID );

    setUserControlState ( userControl, true, false );
    getIdentityView ()?.renderUserStatus ( 'Resolving Steam user…' );
    updateGameBanner ( null );
    setApplicationStatus ( 'Resolving Steam user.' );

    if ( gameControl !== null )
    {
        setGameControlStatus ( gameControl, 'Resolving Steam user…' );
    }

    if ( sortControl !== null )
    {
        sortControl.disabled = true;
    }

    if ( userInput.length === 0 )
    {
        const error = new ApplicationApiError (
            'STEAM_USER_IDENTIFIER_INVALID',
            'Enter a valid SteamID64, Steam Community profile URL, or custom Steam Community URL name.',
            400,
        );

        failUserResolution ( applicationState, requestNumber, error );
        setUserControlState ( userControl, false, true );
        getIdentityView ()?.renderUserStatus ( error.message, true );
        userControl.focus ();

        if ( gameControl !== null )
        {
            setGameControlStatus ( gameControl, 'Enter a Steam user' );
        }

        setApplicationStatus ( error.message );

        return;
    }

    try
    {
        const user = await resolveUser ( userInput );

        if ( !completeUserResolution ( applicationState, requestNumber, user ) )
        {
            return;
        }

        userControl.setAttribute ( 'aria-invalid', 'false' );

        if ( gameControl === null )
        {
            const message = `Resolved Steam user ${getResolvedUserDisplayName ( user )}.`;

            setUserControlState ( userControl, false, false );
            getIdentityView ()?.renderUserStatus ( message );
            setApplicationStatus ( message );

            return;
        }

        await loadVisibleLibrary ( user, requestNumber, gameControl );
    }
    catch ( caughtError )
    {
        const error = normalizeApplicationError (
            caughtError,
            'The application could not resolve that Steam user.',
        );

        if ( !failUserResolution ( applicationState, requestNumber, error ) )
        {
            return;
        }

        setUserControlState ( userControl, false, true );
        getIdentityView ()?.renderUserStatus ( error.message, true );
        userControl.focus ();

        if ( gameControl !== null )
        {
            setGameControlStatus ( gameControl, 'Enter a Steam user' );
        }

        setApplicationStatus ( error.message );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: bindUserControl
//
// Description:
//
//   Submit only through the single-field form. Enter triggers native form submission; keystrokes and blur do not.
//
// Parameters:
//
// - userForm (unknown):
//   The user form used by the operation.
//
// - userControl (unknown):
//   The Steam identifier input controlled by the form.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function bindUserControl ( userForm, userControl )
{
    bindUserIdentifierForm ( userForm, userControl, submittedUserControl =>
    {
        void commitUserValue ( submittedUserControl );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: loadSelectedGame
//
// Description:
//
//   Retrieves selected game through the appropriate application boundary.
//
// Parameters:
//
// - selectedGame (unknown):
//   The normalized game selected by the user.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function loadSelectedGame ( selectedGame )
{
    const resolvedUser  = applicationState.resolvedUser;
    const requestNumber = beginGameLoad ( applicationState, selectedGame );

    if ( resolvedUser === null || requestNumber === null )
    {
        return;
    }

    pendingScreenshotFiles = [];
    document.getElementById ( SCREENSHOT_CONTROL_ELEMENT_ID )?.setAttribute ( 'disabled', '' );
    updateGameBanner ( selectedGame );
    renderAchievementProgressLoading ( 'Loading achievement progress for ' + selectedGame.name + '…' );
    replaceAchievementListWithStatus ( `Loading achievements for ${selectedGame.name}…` );
    setApplicationStatus ( `Loading achievements for ${selectedGame.name}.` );

    try
    {
        const selectedGameAchievements = await retrieveSelectedGameAchievements (
            resolvedUser.steamId,
            selectedGame.appId,
        );

        if ( !completeGameLoad ( applicationState, requestNumber, selectedGameAchievements ) )
        {
            return;
        }

        updateGameBanner ( selectedGameAchievements.game );
        renderAchievementProgress ( selectedGameAchievements.progress );
        buildAchievementRows ( selectedGameAchievements.achievements );
        applySortField ( applicationState.selectedSort ?? DEFAULT_SORT_FIELD_ID );

        const lockedControl     = document.getElementById ( SHOW_LOCKED_CONTROL_ELEMENT_ID );
        const sortControl       = document.getElementById ( SORT_CONTROL_ELEMENT_ID );
        const screenshotControl = document.getElementById ( SCREENSHOT_CONTROL_ELEMENT_ID );

        if ( lockedControl !== null )
        {
            lockedControl.disabled = selectedGameAchievements.achievements.length === 0;
        }

        if ( sortControl !== null )
        {
            sortControl.disabled = selectedGameAchievements.achievements.length === 0;
        }

        if ( screenshotControl !== null )
        {
            screenshotControl.disabled = selectedGameAchievements.achievements.length === 0;
        }

        setApplicationStatus ( getRarityAvailabilityMessage ( selectedGameAchievements ) );
    }
    catch ( caughtError )
    {
        const error = normalizeApplicationError (
            caughtError,
            'The application could not retrieve achievements for that game.',
        );

        if ( !failGameLoad ( applicationState, requestNumber, error ) )
        {
            return;
        }

        renderAchievementProgressStatus ( error.message );
        replaceAchievementListWithStatus ( error.message, true );
        setApplicationStatus ( error.message );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: bindGameControl
//
// Description:
//
//   Binds game control events to the supplied controller and state callbacks.
//
// Parameters:
//
// - gameControl (unknown):
//   The game control used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function bindGameControl ( gameControl )
{
    gameControl.addEventListener ( 'change', () =>
    {
        const selectedAppId = Number ( gameControl.value );
        const selectedGame  = applicationState.games.find ( game => game.appId === selectedAppId );

        if ( selectedGame === undefined )
        {
            clearGameSelection ( applicationState );
            updateGameBanner ( null );
            renderNoGameSelectedProgress ();
            replaceAchievementListWithStatus ( 'Select a game to continue.' );
            document.getElementById ( SCREENSHOT_CONTROL_ELEMENT_ID )?.setAttribute ( 'disabled', '' );

            return;
        }

        void loadSelectedGame ( selectedGame );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: bindSortControl
//
// Description:
//
//   Re-sort the list whenever the control's value changes.
//
//   Bound to `change` rather than to `input`, and there is no apply button, no confirmation, and no second control:
//   choosing an option is the whole interaction. The handler reads the control rather than closing over a value, so
//   the applied order is always the order the control is displaying.
//
//   Order first, then announce. This is the only place the two are paired -- start-up applies an order without
//   announcing one -- which is what keeps the live region a report of a change the reader made rather than a
//   description of the page's initial state.
//
// Parameters:
//
// - sortControl (unknown):
//   The sort control used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function bindSortControl ( sortControl )
{
    sortControl.addEventListener ( 'change', () =>
    {
        applicationState.selectedSort = sortControl.value;

        applySortField ( sortControl.value );
        announceSortOrder ( sortControl.value );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: downloadNextPreparedScreenshotFile
//
// Description:
//
//   Starts the next prepared browser download and retains the file when the browser rejects the attempt.
//
// Returns:
//
//   True when a prepared file was started; otherwise false.
//
//---------------------------------------------------------------------------------------------------------------------

function downloadNextPreparedScreenshotFile ()
{
    const pendingFile = pendingScreenshotFiles [ 0 ];

    if ( pendingFile === undefined )
    {
        return false;
    }

    try
    {
        downloadPreparedScreenshotFile ( pendingFile );
        pendingScreenshotFiles.shift ();

        setApplicationStatus (
            pendingScreenshotFiles.length === 0
                ? `Downloaded ${pendingFile.fileName}. Click Screenshot to create another screenshot.`
                : `Downloaded ${pendingFile.fileName}. Click Screenshot again to download the next PNG.`,
        );

        return true;
    }
    catch
    {
        setApplicationStatus ( 'The prepared screenshot could not be downloaded.' );

        return false;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: saveAchievementScreenshot
//
// Description:
//
//   Saves the current selected-game card as a PNG while preventing duplicate export requests.
//
// Parameters:
//
// - screenshotControl (HTMLButtonElement):
//   The screenshot button whose busy state reflects the export lifecycle.
//
// - achievementCard (HTMLElement):
//   The active achievement card to export.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function saveAchievementScreenshot ( screenshotControl, achievementCard )
{
    if ( pendingScreenshotFiles.length > 0 )
    {
        downloadNextPreparedScreenshotFile ();

        return;
    }

    const selectedGame = applicationState.selectedGame;

    if (
        selectedGame === null
        || applicationState.achievements.length === 0
    )
    {
        return;
    }

    if ( isScreenshotExportInProgress )
    {
        setApplicationStatus ( 'A screenshot export is already in progress.' );

        return;
    }

    isScreenshotExportInProgress = true;
    screenshotControl.setAttribute ( 'aria-busy', 'true' );

    const progressController = getScreenshotProgressController ();
    let screenshotStatusMessage = null;

    try
    {
        const result = await captureAchievementScreenshot (
            achievementCard,
            selectedGame.name,
            message =>
            {
                // A modal makes the sibling application live region inert, so terminal text is announced after close.
                screenshotStatusMessage = message;
            },
            progressReport => progressController?.update ( progressReport, screenshotControl ),
        );

        if ( result.kind === 'cancelled' )
        {
            progressController?.close ();
            setApplicationStatus ( screenshotStatusMessage ?? 'Screenshot export cancelled.' );

            return;
        }

        if ( result.kind === 'saved' )
        {
            progressController?.close ();
            setApplicationStatus ( screenshotStatusMessage ?? 'Screenshot saved.' );

            return;
        }

        if ( result.kind === 'download-ready' )
        {
            pendingScreenshotFiles = result.files;

            if ( !result.nativeDestinationUnused )
            {
                try
                {
                    progressController?.close ();
                }
                finally
                {
                    downloadNextPreparedScreenshotFile ();
                }

                return;
            }

            progressController?.close ();

            const unusedDestinationMessage = result.nativeDestinationUnused
                ? 'The selected single-file destination was not written because numbered fallback was required. '
                : '';

            setApplicationStatus (
                unusedDestinationMessage + ( result.fileCount === 1
                    ? 'Screenshot ready. Click Screenshot to download.'
                    : `${result.fileCount} screenshot files are ready. Click Screenshot to download the first PNG.` ),
            );
        }
    }
    catch ( error )
    {
        const message = error instanceof ScreenshotExportError
            ? error.message
            : 'The achievement screenshot could not be created.';

        progressController?.close ();
        setApplicationStatus ( message );
    }
    finally
    {
        try
        {
            progressController?.close ();
        }
        finally
        {
            isScreenshotExportInProgress = false;
            screenshotControl.removeAttribute ( 'aria-busy' );
        }
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: returnToUserCard
//
// Description:
//
//   Resets dependent application state before returning to user card.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function returnToUserCard ()
{
    resetUserFlow ( applicationState );
    pendingScreenshotFiles = [];

    const gameControl       = document.getElementById ( GAME_CONTROL_ELEMENT_ID );
    const lockedControl     = document.getElementById ( SHOW_LOCKED_CONTROL_ELEMENT_ID );
    const sortControl       = document.getElementById ( SORT_CONTROL_ELEMENT_ID );
    const screenshotControl = document.getElementById ( SCREENSHOT_CONTROL_ELEMENT_ID );

    clearAchievementRows ();
    updateGameBanner ( null );
    renderNoGameSelectedProgress ();

    if ( gameControl !== null )
    {
        setGameControlStatus ( gameControl, 'Enter a Steam user' );
    }

    if ( sortControl !== null )
    {
        sortControl.value    = DEFAULT_SORT_FIELD_ID;
        sortControl.disabled = true;
    }

    if ( lockedControl !== null )
    {
        lockedControl.checked  = false;
        lockedControl.disabled = true;
    }

    if ( screenshotControl !== null )
    {
        screenshotControl.disabled = true;
    }

    getIdentityView ()?.showUserCard ();
    setApplicationStatus ( 'Enter another SteamID or profile URL.' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: startApplication
//
// Description:
//
//   Bring the page up.
//
//   Controls and generic empty states are initialized without constructing achievement content. Semantic rows are
//   created only after a selected-game response arrives, so no game-specific fallback data exists in the browser.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function startApplication ()
{
    const gameControl       = document.getElementById ( GAME_CONTROL_ELEMENT_ID );
    const lockedControl     = document.getElementById ( SHOW_LOCKED_CONTROL_ELEMENT_ID );
    const sortControl       = document.getElementById ( SORT_CONTROL_ELEMENT_ID );
    const userControl       = document.getElementById ( USER_CONTROL_ELEMENT_ID );
    const userForm          = document.getElementById ( USER_FORM_ELEMENT_ID );
    const changeUser        = document.getElementById ( CHANGE_USER_ELEMENT_ID );
    const screenshotControl = document.getElementById ( SCREENSHOT_CONTROL_ELEMENT_ID );
    const achievementCard   = document.getElementById ( ACHIEVEMENT_CARD_ELEMENT_ID );

    getIdentityView ()?.showAvatarFallback ();
    updateGameBanner ( null );
    renderNoGameSelectedProgress ();

    if ( sortControl !== null )
    {
        populateSortControl ( sortControl );
        bindSortControl ( sortControl );

        applicationState.selectedSort = sortControl.value;
    }

    if ( userControl !== null && userForm !== null )
    {
        bindUserControl ( userForm, userControl );
    }

    if ( lockedControl !== null )
    {
        lockedControl.checked = false;

        bindLockedAchievementControl ( lockedControl, applicationState, () =>
        {
            applySortField ( applicationState.selectedSort ?? DEFAULT_SORT_FIELD_ID );
            announceLockedAchievementVisibility ();
        } );
    }

    if ( gameControl !== null )
    {
        bindGameControl ( gameControl );
    }

    if ( changeUser !== null )
    {
        changeUser.addEventListener ( 'click', returnToUserCard );
    }

    if ( screenshotControl !== null && achievementCard !== null )
    {
        screenshotControl.addEventListener ( 'click', () =>
        {
            void saveAchievementScreenshot ( screenshotControl, achievementCard );
        } );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Entry point.
//
// The one statement in the behaviour layer that runs on load. Everything else in js/ is a declaration waiting to be
// called from here.
//---------------------------------------------------------------------------------------------------------------------

startApplication ();
