//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/frontend-locked-achievements.test.js
//
// Description:
//   Verifies the Phase 11 native checkbox, local visibility projection, selected-field ordering, deterministic field
//   comparisons, and the invariant that checkbox changes neither contact the network nor alter canonical progress.
//---------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { bindLockedAchievementControl } from '../public/js/locked-achievement-control.js';
import {
    DEFAULT_SORT_FIELD_ID,
    selectAchievementsForDisplay,
    SORT_FIELDS,
} from '../public/js/sort-fields.js';

//---------------------------------------------------------------------------------------------------------------------
// Class: FakeCheckbox
//
// Description:
//
//   Provides a lightweight checkbox test double for deterministic DOM assertions.
//
//---------------------------------------------------------------------------------------------------------------------

class FakeCheckbox
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a FakeCheckbox instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    constructor ()
    {
        this.checked   = false;
        this.listeners = new Map ();
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
    // Function: dispatchChange
    //
    // Description:
    //
    //   Coordinates dispatch change using the function's documented inputs and application boundary.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    dispatchChange ()
    {
        this.listeners.get ( 'change' )?. ();
    }
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
// - apiName (string):
//   The API name used by the operation.
//
// - name (string):
//   The name used by the operation.
//
// - achieved (boolean):
//   The achieved used by the operation.
//
// - globalPercentage (unknown):
//   The global percentage used by the operation.
//
// - unlockTime (number):
//   The Unix timestamp associated with the unlock state.
//
// Returns:
//
//   The result produced by the create achievement operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createAchievement ( apiName, name, achieved, globalPercentage, unlockTime )
{
    return (
        {
            achieved,
            apiName,
            description: null,
            globalPercentage,
            iconGrayUrl: null,
            iconUrl: null,
            name,
            progress: null,
            unlockTime,
        }
    );
}

const ACHIEVEMENTS =
[
    createAchievement ( 'LOCKED_GAMMA', 'Gamma', false, null, null ),
    createAchievement ( 'UNLOCKED_ALPHA', 'Alpha', true, 40, 100 ),
    createAchievement ( 'LOCKED_BETA', 'Beta', false, 1, null ),
    createAchievement ( 'UNLOCKED_UNAVAILABLE', 'Unavailable', true, null, 200 ),
    createAchievement ( 'LOCKED_ALPHA', 'Alpha', false, 30, null ),
    createAchievement ( 'UNLOCKED_BETA', 'Beta', true, 2, 300 ),
];

//---------------------------------------------------------------------------------------------------------------------
// Function: getApiNames
//
// Description:
//
//   Retrieves API names through the appropriate application boundary.
//
// Parameters:
//
// - achievements (array):
//   The normalized achievements to process.
//
// Returns:
//
//   The result produced by the get API names operation.
//
//---------------------------------------------------------------------------------------------------------------------

function getApiNames ( achievements )
{
    return achievements.map ( achievement => achievement.apiName );
}

describe ( 'Locked-achievement control', () =>
{
    it ( 'ships an unchecked native checkbox with the exact visible label', () =>
    {
        const indexSource = readFileSync ( new URL ( '../public/index.html', import.meta.url ), 'utf8' );
        const inputMatch  = indexSource.match (
            /<input class="control-bar__checkbox"[\s\S]*?id="show-locked-achievements"[\s\S]*?type="checkbox"[\s\S]*?>/,
        );

        expect ( inputMatch?.[ 0 ] ).not.toContain ( 'checked' );
        expect ( indexSource ).toContain (
            '<label class="control-bar__label" for="show-locked-achievements">Show locked Achievements</label>',
        );
    } );

    it ( 'changes only local visibility state and leaves canonical achievements, progress, and fetch untouched', () =>
    {
        const checkbox           = new FakeCheckbox ();
        const canonicalProgress  = { percentage: 50, total: 6, unlocked: 3 };
        const fetchFunction      = vi.fn ();
        const onVisibilityChange = vi.fn ();
        const state              =
        {
            achievements:          ACHIEVEMENTS,
            progress:              canonicalProgress,
            showLockedAchievements: false,
        };

        vi.stubGlobal ( 'fetch', fetchFunction );
        bindLockedAchievementControl ( checkbox, state, onVisibilityChange );

        checkbox.checked = true;
        checkbox.dispatchChange ();

        expect ( state.showLockedAchievements ).toBe ( true );
        expect ( state.achievements ).toBe ( ACHIEVEMENTS );
        expect ( state.progress ).toBe ( canonicalProgress );
        expect ( fetchFunction ).not.toHaveBeenCalled ();
        expect ( onVisibilityChange ).toHaveBeenCalledTimes ( 1 );

        vi.unstubAllGlobals ();
    } );

    it ( 'hides all locked achievements when unchecked and reveals them when checked', () =>
    {
        const hiddenLocked = selectAchievementsForDisplay ( ACHIEVEMENTS, 'rarity', false );
        const shownLocked  = selectAchievementsForDisplay ( ACHIEVEMENTS, 'rarity', true );

        expect ( hiddenLocked.every ( achievement => achievement.achieved ) ).toBe ( true );
        expect ( hiddenLocked ).toHaveLength ( 3 );
        expect ( shownLocked ).toHaveLength ( ACHIEVEMENTS.length );
        expect ( shownLocked.some ( achievement => !achievement.achieved ) ).toBe ( true );
    } );
} );

describe ( 'Phase 11 sort fields', () =>
{
    it ( 'offers exactly Rarity, Name, and Date Unlocked with Rarity as the default', () =>
    {
        expect ( SORT_FIELDS.map ( field => field.label ) ).toEqual ( [ 'Rarity', 'Name', 'Date Unlocked' ] );
        expect ( SORT_FIELDS.map ( field => field.id ) ).toEqual ( [ 'rarity', 'name', 'date-unlocked' ] );
        expect ( DEFAULT_SORT_FIELD_ID ).toBe ( 'rarity' );
    } );

    it ( 'sorts all visible achievements globally by rarity with unavailable rarity last', () =>
    {
        expect ( getApiNames ( selectAchievementsForDisplay ( ACHIEVEMENTS, 'rarity', true ) ) ).toEqual (
            [
                'LOCKED_BETA',
                'UNLOCKED_BETA',
                'LOCKED_ALPHA',
                'UNLOCKED_ALPHA',
                'LOCKED_GAMMA',
                'UNLOCKED_UNAVAILABLE',
            ],
        );
    } );

    it ( 'sorts all visible achievements globally by name', () =>
    {
        expect ( getApiNames ( selectAchievementsForDisplay ( ACHIEVEMENTS, 'name', true ) ) ).toEqual (
            [
                'LOCKED_ALPHA',
                'UNLOCKED_ALPHA',
                'LOCKED_BETA',
                'UNLOCKED_BETA',
                'LOCKED_GAMMA',
                'UNLOCKED_UNAVAILABLE',
            ],
        );
    } );

    it ( 'sorts globally by date unlocked with unavailable dates last and deterministic name tie-breaks', () =>
    {
        expect ( getApiNames ( selectAchievementsForDisplay ( ACHIEVEMENTS, 'date-unlocked', true ) ) ).toEqual (
            [
                'UNLOCKED_BETA',
                'UNLOCKED_UNAVAILABLE',
                'UNLOCKED_ALPHA',
                'LOCKED_ALPHA',
                'LOCKED_BETA',
                'LOCKED_GAMMA',
            ],
        );
    } );

    it ( 'uses name and API-name tie-breaks deterministically without mutating the source array', () =>
    {
        const sameValueAchievements =
        [
            createAchievement ( 'ACHIEVEMENT_Z', 'Same Name', true, 10, 100 ),
            createAchievement ( 'ACHIEVEMENT_A', 'Same Name', true, 10, 100 ),
            createAchievement ( 'ACHIEVEMENT_B', 'Another Name', true, 10, 100 ),
        ];
        const originalOrder = getApiNames ( sameValueAchievements );

        expect ( getApiNames ( selectAchievementsForDisplay ( sameValueAchievements, 'rarity', true ) ) ).toEqual (
            [ 'ACHIEVEMENT_B', 'ACHIEVEMENT_A', 'ACHIEVEMENT_Z' ],
        );
        expect ( getApiNames ( selectAchievementsForDisplay ( sameValueAchievements, 'date-unlocked', true ) ) ).toEqual (
            [ 'ACHIEVEMENT_B', 'ACHIEVEMENT_A', 'ACHIEVEMENT_Z' ],
        );
        expect ( getApiNames ( sameValueAchievements ) ).toEqual ( originalOrder );
    } );

    it ( 'updates live-region wording for sort and locked visibility changes', () =>
    {
        const appSource = readFileSync ( new URL ( '../public/js/app.js', import.meta.url ), 'utf8' );

        expect ( SORT_FIELDS.every ( field => field.announcement.length > 0 ) ).toBe ( true );
        expect ( appSource ).not.toContain ( 'Unlocked achievements are shown before locked achievements.' );
        expect ( appSource ).toContain ( 'Locked achievements are hidden.' );
    } );
} );
