//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-04
// Author:  Rohin Gosling
//
// Description:
//
//   Provides deterministic Vitest coverage for frontend banner behavior.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------
import { describe, expect, it, vi } from 'vitest';

import { retrieveSelectedGameAchievements } from '../public/js/api-client.js';
import {
    createGameBannerController,
    getBannerScreenshotCandidates,
} from '../public/js/banner-view.js';
import {
    beginGameLoad,
    clearGameSelection,
    completeGameLoad,
} from '../public/js/state.js';

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
// Function: createApplicationState
//
// Description:
//
//   Creates application state from the supplied inputs.
//
// Returns:
//
//   The result produced by the create application state operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createApplicationState ()
{
    return (
        {
            achievements: [],
            error:             null,
            gameRequestNumber: 0,
            loadingState:      'idle',
            progress:          null,
            resolvedUser:      { steamId: '76561198000000000' },
            selectedAppId:     null,
            selectedGame:      null,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSelectedGameAchievements
//
// Description:
//
//   Creates selected game achievements from the supplied inputs.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The result produced by the create selected game achievements operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createSelectedGameAchievements ( appId = 620 )
{
    return (
        {
            achievements:
            [
                {
                    achieved:         true,
                    apiName:          'ACH_WIN_ONE_GAME',
                    description:      'Complete one chamber.',
                    globalPercentage: 42.5,
                    iconGrayUrl:      'https://cdn.example/locked.jpg',
                    iconUrl:          'https://cdn.example/unlocked.jpg',
                    name:             'Lab Rat',
                    progress:
                    {
                        current: 10,
                        minimum: 0,
                        target:  10,
                    },
                    unlockTime:       1_700_000_000,
                },
            ],
            game:
            {
                appId,
                bannerUrls:
                [
                    'https://cdn.example/library_hero.jpg',
                    'https://cdn.example/header.jpg',
                    'https://cdn.example/capsule.jpg',
                ],
                iconUrl:         'https://cdn.example/icon.jpg',
                libraryLogoUrls:
                [
                    'https://cdn.example/logo_2x.png',
                    'https://cdn.example/logo.png',
                ],
                name:            'Portal 2',
            },
            progress:
            {
                percentage: 100,
                total:      1,
                unlocked:   1,
            },
        }
    );
}

describe ( 'Dynamic game banner', () =>
{
    it ( 'starts with the generic application fallback', () =>
    {
        const artwork      = new FakeElement ();
        const image        = new FakeElement ();
        const fallback     = new FakeElement ();
        const fallbackLogo = new FakeElement ();
        const fallbackText = new FakeElement ();
        const fallbackVersion = new FakeElement ();
        const gameLogo     = new FakeElement ();
        const controller   = createGameBannerController (
            artwork,
            image,
            gameLogo,
            fallback,
            fallbackLogo,
            fallbackText,
            fallbackVersion,
        );

        controller.render ();

        expect ( image.hidden ).toBe ( true );
        expect ( artwork.hidden ).toBe ( true );
        expect ( image.getAttribute ( 'src' ) ).toBeNull ();
        expect ( gameLogo.hidden ).toBe ( true );
        expect ( gameLogo.getAttribute ( 'src' ) ).toBeNull ();
        expect ( fallback.hidden ).toBe ( false );
        expect ( fallbackLogo.hidden ).toBe ( false );
        expect ( fallbackText.textContent ).toBe ( 'Steam Achievement Browser' );
        expect ( fallbackVersion.hidden ).toBe ( false );
        expect ( getBannerScreenshotCandidates ( image ) ).toEqual ( [] );
        expect ( getBannerScreenshotCandidates ( gameLogo ) ).toEqual ( [] );
    } );

    it ( 'attempts Library Hero, Store header, Store capsule, icon, and game-name text in order', () =>
    {
        const artwork      = new FakeElement ();
        const image        = new FakeElement ();
        const fallback     = new FakeElement ();
        const fallbackLogo = new FakeElement ();
        const fallbackText = new FakeElement ();
        const fallbackVersion = new FakeElement ();
        const gameLogo     = new FakeElement ();
        const controller   = createGameBannerController (
            artwork,
            image,
            gameLogo,
            fallback,
            fallbackLogo,
            fallbackText,
            fallbackVersion,
        );

        controller.render (
            {
                bannerUrls:
                [
                    'https://cdn.example/library_hero.jpg',
                    'https://cdn.example/header.jpg',
                    'https://cdn.example/capsule.jpg',
                ],
                iconUrl:         'https://cdn.example/icon.jpg',
                libraryLogoUrls:
                [
                    'https://cdn.example/logo_2x.png',
                    'https://cdn.example/logo.png',
                ],
                name:            'Portal 2',
            },
        );

        expect ( image.getAttribute ( 'src' ) ).toBe ( 'https://cdn.example/library_hero.jpg' );
        expect ( getBannerScreenshotCandidates ( image ) ).toEqual (
            [
                { artworkKind: 'library-hero', url: 'https://cdn.example/library_hero.jpg' },
                { artworkKind: 'fallback', url: 'https://cdn.example/header.jpg' },
                { artworkKind: 'fallback', url: 'https://cdn.example/capsule.jpg' },
                { artworkKind: 'fallback', url: 'https://cdn.example/icon.jpg' },
            ],
        );
        expect ( fallbackLogo.hidden ).toBe ( true );
        expect ( fallbackVersion.hidden ).toBe ( true );
        expect ( fallbackText.textContent ).toBe ( 'Portal 2' );

        image.dispatch ( 'error' );

        expect ( image.getAttribute ( 'src' ) ).toBe ( 'https://cdn.example/header.jpg' );
        expect ( getBannerScreenshotCandidates ( image ) ).toEqual (
            [
                { artworkKind: 'fallback', url: 'https://cdn.example/header.jpg' },
                { artworkKind: 'fallback', url: 'https://cdn.example/capsule.jpg' },
                { artworkKind: 'fallback', url: 'https://cdn.example/icon.jpg' },
            ],
        );

        image.dispatch ( 'error' );

        expect ( image.getAttribute ( 'src' ) ).toBe ( 'https://cdn.example/capsule.jpg' );

        image.dispatch ( 'error' );

        expect ( image.getAttribute ( 'src' ) ).toBe ( 'https://cdn.example/icon.jpg' );

        image.dispatch ( 'error' );

        expect ( image.hidden ).toBe ( true );
        expect ( image.getAttribute ( 'src' ) ).toBeNull ();
        expect ( getBannerScreenshotCandidates ( image ) ).toEqual ( [] );
        expect ( fallback.hidden ).toBe ( false );
        expect ( fallbackLogo.hidden ).toBe ( true );

        controller.render (
            {
                bannerUrls: [ 'https://cdn.example/header.jpg' ],
                iconUrl:          null,
                libraryLogoUrls: [],
                name:             'Portal 2',
            },
        );
        image.dispatch ( 'load' );

        expect ( artwork.hidden ).toBe ( false );
        expect ( artwork.getAttribute ( 'data-artwork-kind' ) ).toBe ( 'fallback' );
        expect ( image.hidden ).toBe ( false );
        expect ( image.alt ).toBe ( 'Portal 2 artwork' );
        expect ( fallback.hidden ).toBe ( true );
    } );

    it ( 'shows a best-effort Library Logo only after the Library Hero loads', () =>
    {
        const artwork      = new FakeElement ();
        const image        = new FakeElement ();
        const fallback     = new FakeElement ();
        const fallbackLogo = new FakeElement ();
        const fallbackText = new FakeElement ();
        const fallbackVersion = new FakeElement ();
        const gameLogo     = new FakeElement ();
        const controller   = createGameBannerController (
            artwork,
            image,
            gameLogo,
            fallback,
            fallbackLogo,
            fallbackText,
            fallbackVersion,
        );

        controller.render (
            {
                bannerUrls:
                [
                    'https://cdn.example/library_hero.jpg',
                    'https://cdn.example/header.jpg',
                ],
                iconUrl:         null,
                libraryLogoUrls:
                [
                    'https://cdn.example/logo_2x.png',
                    'https://cdn.example/logo.png',
                ],
                name:            'Portal 2',
            },
        );

        expect ( gameLogo.hidden ).toBe ( true );
        expect ( gameLogo.getAttribute ( 'src' ) ).toBeNull ();
        expect ( getBannerScreenshotCandidates ( gameLogo ) ).toEqual ( [] );

        image.dispatch ( 'load' );

        expect ( artwork.hidden ).toBe ( false );
        expect ( artwork.getAttribute ( 'data-artwork-kind' ) ).toBe ( 'library-hero' );
        expect ( gameLogo.hidden ).toBe ( true );
        expect ( gameLogo.getAttribute ( 'src' ) ).toBe ( 'https://cdn.example/logo_2x.png' );
        expect ( getBannerScreenshotCandidates ( gameLogo ) ).toEqual (
            [
                { artworkKind: null, url: 'https://cdn.example/logo_2x.png' },
                { artworkKind: null, url: 'https://cdn.example/logo.png' },
            ],
        );

        gameLogo.dispatch ( 'error' );

        expect ( gameLogo.getAttribute ( 'src' ) ).toBe ( 'https://cdn.example/logo.png' );
        expect ( getBannerScreenshotCandidates ( gameLogo ) ).toEqual (
            [ { artworkKind: null, url: 'https://cdn.example/logo.png' } ],
        );

        gameLogo.dispatch ( 'load' );

        expect ( gameLogo.hidden ).toBe ( false );
        expect ( gameLogo.alt ).toBe ( '' );

        const returnedCandidates = getBannerScreenshotCandidates ( gameLogo );

        returnedCandidates.length = 0;

        expect ( getBannerScreenshotCandidates ( gameLogo ) ).toEqual (
            [ { artworkKind: null, url: 'https://cdn.example/logo.png' } ],
        );

        controller.render ();

        expect ( getBannerScreenshotCandidates ( image ) ).toEqual ( [] );
        expect ( getBannerScreenshotCandidates ( gameLogo ) ).toEqual ( [] );
    } );

    it ( 'does not overlay the Library Logo when the Hero falls through to Store artwork', () =>
    {
        const artwork      = new FakeElement ();
        const image        = new FakeElement ();
        const fallback     = new FakeElement ();
        const fallbackLogo = new FakeElement ();
        const fallbackText = new FakeElement ();
        const fallbackVersion = new FakeElement ();
        const gameLogo     = new FakeElement ();
        const controller   = createGameBannerController (
            artwork,
            image,
            gameLogo,
            fallback,
            fallbackLogo,
            fallbackText,
            fallbackVersion,
        );

        controller.render (
            {
                bannerUrls:
                [
                    'https://cdn.example/library_hero.jpg',
                    'https://cdn.example/header.jpg',
                ],
                iconUrl:          null,
                libraryLogoUrls: [ 'https://cdn.example/logo.png' ],
                name:             'Portal 2',
            },
        );

        image.dispatch ( 'error' );
        image.dispatch ( 'load' );

        expect ( image.getAttribute ( 'src' ) ).toBe ( 'https://cdn.example/header.jpg' );
        expect ( artwork.getAttribute ( 'data-artwork-kind' ) ).toBe ( 'fallback' );
        expect ( gameLogo.hidden ).toBe ( true );
        expect ( gameLogo.getAttribute ( 'src' ) ).toBeNull ();
    } );

    it ( 'keeps only the latest selected-game response in state', () =>
    {
        const state          = createApplicationState ();
        const portalRequest  = beginGameLoad ( state, { appId: 400, name: 'Portal' } );
        const portal2Request = beginGameLoad ( state, { appId: 620, name: 'Portal 2' } );

        expect ( completeGameLoad ( state, portalRequest, createSelectedGameAchievements ( 400 ) ) ).toBe ( false );
        expect ( completeGameLoad ( state, portal2Request, createSelectedGameAchievements ( 620 ) ) ).toBe ( true );
        expect ( state.selectedGame.name ).toBe ( 'Portal 2' );

        clearGameSelection ( state );

        expect ( state.selectedAppId ).toBeNull ();
        expect ( state.selectedGame ).toBeNull ();
    } );

    it ( 'requests and validates normalized selected-game achievements', async () =>
    {
        const responseBody  = createSelectedGameAchievements ();
        const fetchFunction = vi.fn ( async () => Response.json ( responseBody ) );
        const result        = await retrieveSelectedGameAchievements (
            '76561198000000000',
            620,
            fetchFunction,
        );

        expect ( result.game.bannerUrls ).toEqual (
            [
                'https://cdn.example/library_hero.jpg',
                'https://cdn.example/header.jpg',
                'https://cdn.example/capsule.jpg',
            ],
        );
        expect ( result.game.libraryLogoUrls ).toEqual (
            [
                'https://cdn.example/logo_2x.png',
                'https://cdn.example/logo.png',
            ],
        );
        expect ( fetchFunction ).toHaveBeenCalledWith (
            '/api/users/76561198000000000/games/620/achievements',
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    } );
} );
