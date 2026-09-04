//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/frontend-error-states.test.js
//
// Description:
//   Verifies Phase 13 user-facing error categories and optional rarity/artwork degradation without exposing raw
//   upstream diagnostics or discarding usable achievement content.
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { createGameBannerController } from '../public/js/banner-view.js';
import { getApplicationErrorMessage, getRarityAvailabilityMessage } from '../public/js/error-view.js';

//---------------------------------------------------------------------------------------------------------------------
// Class: FakeElement
//
// Description:
//
//   Provides a lightweight element test double for deterministic DOM assertions.
//
//---------------------------------------------------------------------------------------------------------------------

class FakeElement
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a FakeElement instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    constructor ()
    {
        this.alt         = '';
        this.attributes  = new Map ();
        this.hidden      = false;
        this.listeners   = new Map ();
        this.textContent = '';
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: addEventListener
    //
    // Description:
    //
    //   Coordinates add event listener using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - eventName (string):
    //   The event name used by the operation.
    //
    // - listener (unknown):
    //   The listener used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    addEventListener ( eventName, listener )
    {
        this.listeners.set ( eventName, listener );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: dispatch
    //
    // Description:
    //
    //   Coordinates dispatch using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - eventName (string):
    //   The event name used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    dispatch ( eventName )
    {
        this.listeners.get ( eventName )?. ();
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: getAttribute
    //
    // Description:
    //
    //   Retrieves attribute through the appropriate application boundary.
    //
    // Parameters:
    //
    // - attributeName (string):
    //   The attribute name used by the operation.
    //
    // Returns:
    //
    //   The result produced by the get attribute operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    getAttribute ( attributeName )
    {
        return this.attributes.get ( attributeName ) ?? null;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: removeAttribute
    //
    // Description:
    //
    //   Coordinates remove attribute using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - attributeName (string):
    //   The attribute name used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    removeAttribute ( attributeName )
    {
        this.attributes.delete ( attributeName );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: setAttribute
    //
    // Description:
    //
    //   Updates attribute to reflect the current application state.
    //
    // Parameters:
    //
    // - attributeName (string):
    //   The attribute name used by the operation.
    //
    // - attributeValue (unknown):
    //   The attribute value used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    setAttribute ( attributeName, attributeValue )
    {
        this.attributes.set ( attributeName, attributeValue );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createBannerController
//
// Description:
//
//   Creates banner controller from the supplied inputs.
//
// Parameters:
//
// - onArtworkUnavailable (unknown):
//   The callback invoked when every artwork candidate fails.
//
// Returns:
//
//   The result produced by the create banner controller operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createBannerController ( onArtworkUnavailable )
{
    const elements =
    {
        artwork:         new FakeElement (),
        fallback:        new FakeElement (),
        fallbackLogo:    new FakeElement (),
        fallbackText:    new FakeElement (),
        fallbackVersion: new FakeElement (),
        gameLogo:        new FakeElement (),
        image:           new FakeElement (),
    };
    const controller = createGameBannerController (
        elements.artwork,
        elements.image,
        elements.gameLogo,
        elements.fallback,
        elements.fallbackLogo,
        elements.fallbackText,
        elements.fallbackVersion,
        onArtworkUnavailable,
    );

    return (
        { controller, elements }
    );
}

describe ( 'Application error presentation', () =>
{
    it.each (
        [
            [ 'STEAM_PROFILE_PRIVATE', 'set My Profile and Game Details to Public' ],
            [ 'STEAM_USER_IDENTIFIER_INVALID', 'Enter a valid SteamID64' ],
            [ 'STEAM_USER_NOT_FOUND', 'Check the SteamID or profile URL' ],
            [ 'STEAM_GAME_DETAILS_PRIVATE', 'not publicly visible' ],
            [ 'STEAM_LIBRARY_EMPTY', 'No publicly visible Steam games' ],
            [ 'STEAM_GAME_HAS_NO_ACHIEVEMENTS', 'Choose another game' ],
            [ 'STEAM_GAME_NOT_VISIBLE', 'no longer visible' ],
            [ 'STEAM_REQUEST_TIMEOUT', 'did not respond in time' ],
            [ 'STEAM_UNAVAILABLE', 'currently unavailable' ],
        ],
    ) ( 'maps %s to actionable safe copy', ( code, expectedText ) =>
    {
        const message = getApplicationErrorMessage ( { code, message: 'raw upstream diagnostics' } );

        expect ( message ).toContain ( expectedText );
        expect ( message ).not.toContain ( 'raw upstream diagnostics' );
    } );

    it ( 'uses sanitized service copy for malformed and failed Steam responses', () =>
    {
        expect ( getApplicationErrorMessage (
            { code: 'STEAM_INVALID_RESPONSE', message: 'private response body' },
        ) ).toBe ( 'Steam returned an unusable response. Try again in a few minutes.' );
    } );

    it ( 'preserves an already sanitized application error when no category override exists', () =>
    {
        expect ( getApplicationErrorMessage (
            { code: 'GAME_DISCOVERY_CURSOR_INVALID', message: 'Game discovery could not continue.' },
        ) ).toBe ( 'Game discovery could not continue.' );
    } );
} );

describe ( 'Optional selected-game degradation', () =>
{
    it ( 'announces complete and partial rarity loss while keeping loaded content', () =>
    {
        const selectedGameAchievements =
        {
            achievements:
            [
                { globalPercentage: null },
                { globalPercentage: null },
            ],
            game: { name: 'Portal 2' },
        };

        expect ( getRarityAvailabilityMessage ( selectedGameAchievements ) )
            .toBe (
                'Loaded achievements for Portal 2. Global rarity is currently unavailable; '
                    + 'achievement data remains usable.',
            );

        selectedGameAchievements.achievements [ 0 ].globalPercentage = 4.5;

        expect ( getRarityAvailabilityMessage ( selectedGameAchievements ) )
            .toBe ( 'Loaded achievements for Portal 2. Global rarity is unavailable for 1 achievement.' );
    } );

    it ( 'keeps the game-name fallback and reports artwork loss only after every candidate fails', () =>
    {
        const onArtworkUnavailable     = vi.fn ();
        const { controller, elements } = createBannerController ( onArtworkUnavailable );
        const game =
        {
            appId:           620,
            bannerUrls: [ 'https://cdn.example/library_hero.jpg' ],
            iconUrl:         'https://cdn.example/icon.jpg',
            libraryLogoUrls: [],
            name:            'Portal 2',
        };

        controller.render ( game );
        elements.image.dispatch ( 'error' );

        expect ( onArtworkUnavailable ).not.toHaveBeenCalled ();

        elements.image.dispatch ( 'error' );

        expect ( onArtworkUnavailable ).toHaveBeenCalledOnce ();
        expect ( onArtworkUnavailable ).toHaveBeenCalledWith ( game );
        expect ( elements.fallback.hidden ).toBe ( false );
        expect ( elements.fallbackText.textContent ).toBe ( 'Portal 2' );

        elements.image.dispatch ( 'error' );
        expect ( onArtworkUnavailable ).toHaveBeenCalledOnce ();
    } );
} );
