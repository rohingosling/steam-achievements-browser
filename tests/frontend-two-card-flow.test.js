//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/frontend-two-card-flow.test.js
//
// Description:
//   Verifies the two-card structure, shared native form submission, safe persona/avatar rendering, and focus transfer.
//---------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
    bindUserIdentifierForm,
    createIdentityView,
    getResolvedUserDisplayName,
} from '../public/js/identity-view.js';

const indexSource = readFileSync ( new URL ( '../public/index.html', import.meta.url ), 'utf8' );
const packageDefinition = JSON.parse ( readFileSync ( new URL ( '../package.json', import.meta.url ), 'utf8' ) );

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
        this.attributes  = new Map ();
        this.dataset     = {};
        this.focus       = vi.fn ();
        this.hidden      = false;
        this.listeners   = new Map ();
        this.textContent = '';
        this.value       = '';
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
    // - event (unknown):
    //   The event used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    dispatch ( eventName, event = {} )
    {
        this.listeners.get ( eventName )?. ( event );
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
    // - name (string):
    //   The name used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    removeAttribute ( name )
    {
        this.attributes.delete ( name );

        if ( name === 'src' )
        {
            this.src = undefined;
        }
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
    // - name (string):
    //   The name used by the operation.
    //
    // - value (unknown):
    //   The untrusted value to validate or normalize.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    setAttribute ( name, value )
    {
        this.attributes.set ( name, value );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createIdentityElements
//
// Description:
//
//   Creates identity elements from the supplied inputs.
//
// Returns:
//
//   The result produced by the create identity elements operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createIdentityElements ()
{
    return (
        {
            achievementCard:    new FakeElement (),
            achievementHeading: new FakeElement (),
            application:        new FakeElement (),
            avatar:             new FakeElement (),
            avatarFrame:        new FakeElement (),
            avatarPlaceholder:  new FakeElement (),
            personaName:        new FakeElement (),
            userCard:           new FakeElement (),
            userControl:        new FakeElement (),
            userStatus:         new FakeElement (),
        }
    );
}

describe ( 'Initial User ID card', () =>
{
    it ( 'exposes the User ID card while the sibling achievement card is natively hidden', () =>
    {
        expect ( indexSource ).toContain ( '<main class="application" id="application" data-active-card="user-id">' );
        expect ( indexSource ).toContain ( '<section class="user-card" id="user-id-card" aria-busy="false">' );
        expect ( indexSource ).toContain ( '<section class="achievement-card" id="achievement-card" hidden>' );
        expect ( indexSource.match ( /<h1\b/g ) ).toHaveLength ( 2 );
    } );

    it ( 'ships the exact logo, title, field, Continue action, helper copy, and official help link', () =>
    {
        expect ( indexSource ).toContain (
            '<img class="user-card__logo" src="images/ui/steam-logo.jpg" alt="" width="300" height="300">',
        );
        expect ( indexSource ).toContain ( '<h1 class="user-card__title">Steam Achievement Browser</h1>' );
        expect ( indexSource ).toContain ( `<p class="user-card__version">Version ${packageDefinition.version}</p>` );
        expect ( indexSource ).toContain ( '>SteamID</label>' );
        expect ( indexSource ).toContain (
            'Enter a 17-digit SteamID64, a Steam Community profile URL, or your',
        );
        expect ( indexSource ).toContain ( 'custom Steam Community URL name.' );
        expect ( indexSource ).toContain ( 'Need help finding your SteamID? Follow' );
        expect ( indexSource ).toContain ( 'Steam Support’s' );
        expect ( indexSource ).toContain (
            'href="https://help.steampowered.com/en/faqs/view/2816-BE67-5B69-0FEC"',
        );
        expect ( indexSource ).toContain ( 'aria-label="Steam Support instructions for finding your SteamID"' );
        expect ( indexSource ).toContain (
            'aria-describedby="user-identifier-help user-identifier-help-link user-card-status"',
        );
        const formSource = indexSource.slice (
            indexSource.indexOf ( '<form class="user-card__form"' ),
            indexSource.indexOf ( '</form>' ) + 7,
        );
        const inputPosition    = formSource.indexOf ( 'id="user-identifier"' );
        const continuePosition = formSource.indexOf ( 'id="continue-user"' );

        expect ( formSource ).toContain ( 'class="user-card__submit"' );
        expect ( formSource ).toContain ( 'id="continue-user"' );
        expect ( formSource ).toContain ( 'type="submit">Continue</button>' );
        expect ( continuePosition ).toBeGreaterThan ( inputPosition );
    } );
} );

describe ( 'User form submission', () =>
{
    it ( 'binds one form submission without keystroke, change, or blur listeners', () =>
    {
        const form          = new FakeElement ();
        const userControl   = new FakeElement ();
        const submitHandler = vi.fn ();
        const event         = { preventDefault: vi.fn () };

        bindUserIdentifierForm ( form, userControl, submitHandler );
        form.dispatch ( 'submit', event );

        expect ( Array.from ( form.listeners.keys () ) ).toEqual ( [ 'submit' ] );
        expect ( event.preventDefault ).toHaveBeenCalledOnce ();
        expect ( submitHandler ).toHaveBeenCalledOnce ();
        expect ( submitHandler ).toHaveBeenCalledWith ( userControl );
    } );
} );

describe ( 'Achievement card identity', () =>
{
    it ( 'keeps the visual separator space in the dynamic heading accessible text', () =>
    {
        expect ( indexSource ).toContain (
            'class="control-bar__title-suffix"> – Steam Achievements</span>',
        );
    } );

    it ( 'uses normalized SteamID64 when persona text is unavailable', () =>
    {
        expect ( getResolvedUserDisplayName (
            {
                personaName: '   ',
                steamId:     '76561198000000000',
            },
        ) ).toBe ( '76561198000000000' );
    } );

    it ( 'renders persona text safely, reserves avatar geometry, and transfers heading focus', () =>
    {
        const elements = createIdentityElements ();
        const view     = createIdentityView ( elements );
        const user     =
        {
            avatarUrl:  'https://avatars.example.test/user.jpg',
            personaName: '<img src=x onerror=alert(1)>',
            steamId:     '76561198000000000',
        };

        elements.achievementCard.hidden = true;
        view.showAchievementCard ( user );

        expect ( elements.personaName.textContent ).toBe ( '<img src=x onerror=alert(1)>' );
        expect ( elements.avatar.src ).toBe ( user.avatarUrl );
        expect ( elements.avatar.hidden ).toBe ( true );
        expect ( elements.avatarPlaceholder.hidden ).toBe ( false );
        expect ( elements.avatarFrame.dataset.avatarState ).toBe ( 'fallback' );
        expect ( elements.userCard.hidden ).toBe ( true );
        expect ( elements.achievementCard.hidden ).toBe ( false );
        expect ( elements.application.dataset.activeCard ).toBe ( 'achievements' );
        expect ( elements.achievementHeading.focus ).toHaveBeenCalledOnce ();

        elements.avatar.dispatch ( 'load' );
        expect ( elements.avatar.hidden ).toBe ( false );
        expect ( elements.avatarPlaceholder.hidden ).toBe ( true );

        elements.avatar.dispatch ( 'error' );
        expect ( elements.avatar.hidden ).toBe ( true );
        expect ( elements.avatarPlaceholder.hidden ).toBe ( false );
    } );

    it ( 'returns to the User ID card without clearing the editable field and restores focus', () =>
    {
        const elements = createIdentityElements ();
        const view     = createIdentityView ( elements );

        elements.userControl.value      = 'exampleuser';
        elements.userCard.hidden        = true;
        elements.achievementCard.hidden = false;

        view.showUserCard ();

        expect ( elements.userControl.value ).toBe ( 'exampleuser' );
        expect ( elements.userControl.attributes.get ( 'aria-invalid' ) ).toBe ( 'false' );
        expect ( elements.userCard.hidden ).toBe ( false );
        expect ( elements.achievementCard.hidden ).toBe ( true );
        expect ( elements.application.dataset.activeCard ).toBe ( 'user-id' );
        expect ( elements.userControl.focus ).toHaveBeenCalledOnce ();
    } );
} );

describe ( 'Achievement-card controls', () =>
{
    it ( 'places hero actions before the required achievement controls', () =>
    {
        const achievementCardSource = indexSource.slice (
            indexSource.indexOf ( '<section class="achievement-card"' ),
            indexSource.indexOf ( '<div class="visually-hidden"' ),
        );
        const gamePosition       = achievementCardSource.indexOf ( 'id="game-field"' );
        const sortPosition       = achievementCardSource.indexOf ( 'id="sort-field"' );
        const checkboxPosition   = achievementCardSource.indexOf ( 'id="show-locked-achievements"' );
        const changeUserPosition = achievementCardSource.indexOf ( 'id="change-user"' );
        const screenshotPosition = achievementCardSource.indexOf ( 'id="save-achievement-screenshot"' );

        expect ( achievementCardSource ).not.toContain ( 'id="user-identifier"' );
        expect ( changeUserPosition ).toBeLessThan ( screenshotPosition );
        expect ( screenshotPosition ).toBeLessThan ( gamePosition );
        expect ( gamePosition ).toBeLessThan ( sortPosition );
        expect ( sortPosition ).toBeLessThan ( checkboxPosition );
    } );
} );
