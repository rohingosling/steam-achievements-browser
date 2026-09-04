//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/frontend-achievement-rows.test.js
//
// Description:
//   Verifies semantic selected-game rows, normalized icon/metadata fallbacks, and build-once node reordering.
//---------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    applyAchievementOrder,
    buildAchievementRows,
    clearAchievementRows,
    formatAchievementItemProgress,
    formatAchievementRarity,
    formatAchievementUnlockTime,
} from '../public/js/list-view.js';
import { sortAchievements } from '../public/js/sort-fields.js';

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
    // Parameters:
    //
    // - tagName (string):
    //   The tag name used by the operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    constructor ( tagName )
    {
        this.alt         = '';
        this.attributes  = new Map ();
        this.children    = [];
        this.className   = '';
        this.dataset     = {};
        this.hidden      = false;
        this.listeners   = new Map ();
        this.scrollTop   = 0;
        this.tagName     = tagName.toUpperCase ();
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
    // Function: append
    //
    // Description:
    //
    //   Coordinates append using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - children (unknown):
    //   The children used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    append ( ...children )
    {
        this.children.push ( ...children );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: appendChild
    //
    // Description:
    //
    //   Coordinates append child using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - child (unknown):
    //   The child used by the operation.
    //
    // Returns:
    //
    //   The result produced by the append child operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    appendChild ( child )
    {
        this.children.push ( child );

        return child;
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

        if ( attributeName === 'src' )
        {
            delete this.src;
        }
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: replaceChildren
    //
    // Description:
    //
    //   Coordinates replace children using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - children (unknown):
    //   The children used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    replaceChildren ( ...children )
    {
        this.children = children.length === 1 && children [ 0 ].tagName === '#FRAGMENT'
            ? [ ...children [ 0 ].children ]
            : children;
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
        this.attributes.set ( attributeName, String ( attributeValue ) );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: findByClassName
//
// Description:
//
//   Finds by class name from the available candidates.
//
// Parameters:
//
// - element (unknown):
//   The element used by the operation.
//
// - className (string):
//   The class name used by the operation.
//
// Returns:
//
//   The result produced by the find by class name operation.
//
//---------------------------------------------------------------------------------------------------------------------

function findByClassName ( element, className )
{
    if ( element.className === className )
    {
        return element;
    }

    for ( const child of element.children )
    {
        const match = findByClassName ( child, className );

        if ( match !== null )
        {
            return match;
        }
    }

    return null;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createAchievement
//
// Description:
//
//   Creates achievement from the supplied inputs.
//
// Parameters:
//
// - overrides (unknown):
//   The overrides used by the operation.
//
// Returns:
//
//   The result produced by the create achievement operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createAchievement ( overrides = {} )
{
    return (
        {
            achieved:         true,
            apiName:          'ACH_TEST_UNLOCKED',
            description:      'Complete the test chamber.',
            globalPercentage: 12.34,
            iconGrayUrl:      'https://cdn.example/locked.jpg',
            iconUrl:          'https://cdn.example/unlocked.jpg',
            name:             'Test Subject',
            progress:         null,
            unlockTime:       1_700_000_000,
            ...overrides,
        }
    );
}

let achievementList;
let originalDocument;

beforeEach ( () =>
{
    achievementList = new FakeElement ( 'ul' );
    originalDocument = globalThis.document;

    globalThis.document =
    {
        createDocumentFragment: () => new FakeElement ( '#fragment' ),
        createElement:          tagName => new FakeElement ( tagName ),
        getElementById:         elementId => elementId === 'achievement-list' ? achievementList : null,
    };
} );

afterEach ( () =>
{
    clearAchievementRows ();
    globalThis.document = originalDocument;
} );

describe ( 'Semantic achievement rows', () =>
{
    it ( 'renders one list item with non-duplicating icon alt text and complete visible metadata', () =>
    {
        const achievement = createAchievement ();
        const rows         = buildAchievementRows ( [ achievement ] );
        const row          = rows.get ( achievement.apiName );
        const icon         = findByClassName ( row, 'achievement-row__icon' );
        const name         = findByClassName ( row, 'achievement-row__name' );
        const description  = findByClassName ( row, 'achievement-row__description' );
        const rarity       = findByClassName ( row, 'achievement-row__rarity-text' );
        const rarityMeter  = findByClassName ( row, 'achievement-row__rarity-meter' );
        const unlockState  = findByClassName ( row, 'achievement-row__unlock-state' );

        expect ( row.tagName ).toBe ( 'LI' );
        expect ( row.dataset.achievementState ).toBe ( 'unlocked' );
        expect ( icon.alt ).toBe ( '' );
        expect ( icon.src ).toBe ( achievement.iconUrl );
        expect ( icon.width ).toBe ( 64 );
        expect ( icon.height ).toBe ( 64 );
        expect ( name.textContent ).toBe ( achievement.name );
        expect ( description.textContent ).toBe ( achievement.description );
        expect ( rarity.textContent ).toBe ( '12.3% global rarity' );
        expect ( rarityMeter ).toBeNull ();
        expect ( unlockState.tagName ).toBe ( 'TIME' );
        expect ( unlockState.textContent ).toContain ( 'Unlocked ' );
    } );

    it ( 'renders blue item progress only for an accumulative achievement', () =>
    {
        const accumulativeAchievement = createAchievement (
            {
                progress:
                {
                    current: 7,
                    minimum: 0,
                    target:  10,
                },
            },
        );
        const singleEventAchievement = createAchievement (
            {
                apiName:  'ACH_TEST_SINGLE_EVENT',
                progress:
                {
                    current: 0,
                    minimum: 0,
                    target:  1,
                },
            },
        );
        const rows                = buildAchievementRows ( [ accumulativeAchievement, singleEventAchievement ] );
        const accumulativeRow     = rows.get ( accumulativeAchievement.apiName );
        const singleEventRow      = rows.get ( singleEventAchievement.apiName );
        const itemProgressBar     = findByClassName ( accumulativeRow, 'achievement-row__item-progress-bar' );
        const itemProgressText    = findByClassName ( accumulativeRow, 'achievement-row__item-progress-text' );
        const singleEventProgress = findByClassName ( singleEventRow, 'achievement-row__item-progress' );
        const componentsSource    = readFileSync ( new URL ( '../public/css/components.css', import.meta.url ), 'utf8' );

        expect ( itemProgressBar.tagName ).toBe ( 'PROGRESS' );
        expect ( itemProgressBar.value ).toBe ( 7 );
        expect ( itemProgressBar.max ).toBe ( 10 );
        expect ( itemProgressBar.getAttribute ( 'aria-label' ) ).toBe ( 'Achievement progress: 7 of 10' );
        expect ( itemProgressText.textContent ).toBe ( '7 / 10' );
        expect ( singleEventProgress ).toBeNull ();
        expect ( componentsSource ).toMatch (
            /\.achievement-row__item-progress-bar::-webkit-progress-value\s*\{[^}]*var\( --colour-accent \);/,
        );
        expect ( componentsSource ).toMatch (
            /\.achievement-row__item-progress-bar::-moz-progress-bar\s*\{[^}]*var\( --colour-accent \);/,
        );
        expect ( componentsSource ).not.toContain (
            '.achievement-row__item-progress-bar::-webkit-progress-value,',
        );
        expect ( componentsSource ).not.toContain ( '.achievement-row__rarity-meter' );
    } );

    it ( 'uses the grey icon and textual unavailable states for a locked achievement', () =>
    {
        const achievement = createAchievement (
            {
                achieved:         false,
                apiName:          'ACH_TEST_LOCKED',
                description:      null,
                globalPercentage: null,
                unlockTime:       null,
            },
        );
        const row         = buildAchievementRows ( [ achievement ] ).get ( achievement.apiName );
        const description = findByClassName ( row, 'achievement-row__description' );
        const icon        = findByClassName ( row, 'achievement-row__icon' );
        const rarity      = findByClassName ( row, 'achievement-row__rarity-text' );
        const unlockState = findByClassName ( row, 'achievement-row__unlock-state' );

        expect ( row.dataset.achievementState ).toBe ( 'locked' );
        expect ( icon.src ).toBe ( achievement.iconGrayUrl );
        expect ( description.hidden ).toBe ( true );
        expect ( rarity.textContent ).toBe ( 'Rarity unavailable' );
        expect ( unlockState.textContent ).toBe ( 'Locked' );
    } );

    it ( 'moves the same row nodes when order changes', () =>
    {
        const firstAchievement  = createAchievement ();
        const secondAchievement = createAchievement ( { apiName: 'ACH_TEST_SECOND', name: 'Another Test' } );
        const rows              = buildAchievementRows ( [ firstAchievement, secondAchievement ] );
        const firstRow          = rows.get ( firstAchievement.apiName );
        const secondRow         = rows.get ( secondAchievement.apiName );

        applyAchievementOrder ( [ secondAchievement, firstAchievement ] );

        expect ( achievementList.children ).toEqual ( [ secondRow, firstRow ] );
        expect ( achievementList.scrollTop ).toBe ( 0 );

        applyAchievementOrder ( [ firstAchievement, secondAchievement ] );

        expect ( achievementList.children ).toEqual ( [ firstRow, secondRow ] );
    } );

    it ( 'falls back to the neutral icon placeholder after an image error', () =>
    {
        const row         = buildAchievementRows ( [ createAchievement () ] ).values ().next ().value;
        const icon        = findByClassName ( row, 'achievement-row__icon' );
        const placeholder = findByClassName ( row, 'achievement-row__icon-placeholder' );

        icon.dispatch ( 'error' );

        expect ( icon.hidden ).toBe ( true );
        expect ( icon.src ).toBeUndefined ();
        expect ( placeholder.hidden ).toBe ( false );
    } );

    it ( 'has deterministic explicit unavailable formatting', () =>
    {
        expect ( formatAchievementItemProgress ( { current: 7.5, minimum: 0, target: 10 } ) ).toBe ( '7.5 / 10' );
        expect ( formatAchievementRarity ( null ) ).toBe ( 'Rarity unavailable' );
        expect ( formatAchievementUnlockTime ( null, false ) ).toBe ( 'Locked' );
        expect ( formatAchievementUnlockTime ( null, true ) ).toBe ( 'Unlocked' );
    } );

    it ( 'sorts normalized rarity and unlock timestamps while leaving missing values last', () =>
    {
        const commonAchievement = createAchievement ( { globalPercentage: 80, name: 'Common' } );
        const rareAchievement   = createAchievement (
            {
                apiName:          'ACH_TEST_RARE',
                globalPercentage: 2,
                name:             'Rare',
                unlockTime:       1_800_000_000,
            },
        );
        const unavailableAchievement = createAchievement (
            {
                apiName:          'ACH_TEST_UNAVAILABLE',
                globalPercentage: null,
                name:             'Unavailable',
                unlockTime:       null,
            },
        );
        const achievements = [ commonAchievement, unavailableAchievement, rareAchievement ];

        expect ( sortAchievements ( achievements, 'rarity' ).map ( achievement => achievement.name ) ).toEqual (
            [ 'Rare', 'Common', 'Unavailable' ],
        );
        expect ( sortAchievements ( achievements, 'date-unlocked' ).map ( achievement => achievement.name ) ).toEqual (
            [ 'Rare', 'Common', 'Unavailable' ],
        );
        expect ( achievements.map ( achievement => achievement.name ) ).toEqual (
            [ 'Common', 'Unavailable', 'Rare' ],
        );
    } );

    it ( 'ships semantic row sources at the 960px desktop maximum without a raster-row dependency', () =>
    {
        const appSource      = readFileSync ( new URL ( '../public/js/app.js', import.meta.url ), 'utf8' );
        const listViewSource = readFileSync ( new URL ( '../public/js/list-view.js', import.meta.url ), 'utf8' );
        const tokensSource   = readFileSync ( new URL ( '../public/css/tokens.css', import.meta.url ), 'utf8' );

        expect ( appSource ).not.toContain ( "../data/achievements.js" );
        expect ( listViewSource ).not.toContain ( 'achievementImagePath' );
        expect ( listViewSource ).not.toContain ( 'images/items/flat' );
        expect ( tokensSource ).toContain ( '--card-width              : 960px;' );
        expect ( tokensSource ).toContain ( '--achievement-icon-size   : 64px;' );
    } );
} );
