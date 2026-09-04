//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/frontend-progress.test.js
//
// Description:
//   Unit tests for semantic achievement-progress wording, native value/max reflection, and accessible status states.
//---------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createAchievementProgressController } from '../public/js/progress-view.js';

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
        this.hidden      = false;
        this.textContent = '';
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
        this.attributes.set ( attributeName, String ( attributeValue ) );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: FakeProgressElement
//
// Description:
//
//   Provides a lightweight progress element test double for deterministic DOM assertions.
//
//---------------------------------------------------------------------------------------------------------------------

class FakeProgressElement extends FakeElement
{
    //-----------------------------------------------------------------------------------------------------------------
    // Function: max
    //
    // Description:
    //
    //   Coordinates max using the function's documented inputs and application boundary.
    //
    // Returns:
    //
    //   The result produced by the max operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    get max ()
    {
        return Number ( this.getAttribute ( 'max' ) );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: max
    //
    // Description:
    //
    //   Coordinates max using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - value (unknown):
    //   The untrusted value to validate or normalize.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    set max ( value )
    {
        this.setAttribute ( 'max', value );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: value
    //
    // Description:
    //
    //   Coordinates value using the function's documented inputs and application boundary.
    //
    // Returns:
    //
    //   The result produced by the value operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    get value ()
    {
        return Number ( this.getAttribute ( 'value' ) );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: value
    //
    // Description:
    //
    //   Coordinates value using the function's documented inputs and application boundary.
    //
    // Parameters:
    //
    // - value (unknown):
    //   The untrusted value to validate or normalize.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    set value ( value )
    {
        this.setAttribute ( 'value', value );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createController
//
// Description:
//
//   Creates controller from the supplied inputs.
//
// Returns:
//
//   The result produced by the create controller operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createController ()
{
    const percentage  = new FakeElement ();
    const progressBar = new FakeProgressElement ();
    const region      = new FakeElement ();
    const rosette     = new FakeElement ();
    const summary     = new FakeElement ();
    const controller  = createAchievementProgressController ( region, summary, percentage, progressBar, rosette );

    percentage.hidden = true;
    rosette.setAttribute ( 'hidden', '' );

    return (
        {
            controller,
            percentage,
            progressBar,
            region,
            rosette,
            summary,
        }
    );
}

describe ( 'Dynamic achievement progress', () =>
{
    it.each (
        [
            {
                expectedSummary: '0 of 37 achievements unlocked',
                expectedPercentage: '0 %',
                expectedRosette: false,
                progress:        { percentage: 0, total: 37, unlocked: 0 },
            },
            {
                expectedSummary: '31 of 37 achievements unlocked',
                expectedPercentage: '84 %',
                expectedRosette: false,
                progress:        { percentage: 83.78, total: 37, unlocked: 31 },
            },
            {
                expectedSummary: 'All 37 achievements unlocked.',
                expectedPercentage: '100 %',
                expectedRosette: true,
                progress:        { percentage: 100, total: 37, unlocked: 37 },
            },
        ],
    ) ( 'renders $expectedSummary', ( { expectedPercentage, expectedRosette, expectedSummary, progress } ) =>
    {
        const { controller, percentage, progressBar, region, rosette, summary } = createController ();

        controller.render ( progress );

        expect ( summary.textContent ).toBe ( expectedSummary );
        expect ( percentage.hidden ).toBe ( false );
        expect ( percentage.textContent ).toBe ( expectedPercentage );
        expect ( progressBar.hidden ).toBe ( false );
        expect ( progressBar.value ).toBe ( progress.unlocked );
        expect ( progressBar.max ).toBe ( progress.total );
        expect ( progressBar.getAttribute ( 'aria-valuetext' ) ).toBe ( expectedSummary );
        expect ( region.getAttribute ( 'aria-busy' ) ).toBe ( 'false' );
        expect ( region.getAttribute ( 'data-progress-complete' ) ).toBe ( String ( expectedRosette ) );
        expect ( rosette.getAttribute ( 'hidden' ) ).toBe ( expectedRosette ? null : '' );
    } );

    it ( 'uses a separate no-achievements state instead of an invalid zero-max progress bar', () =>
    {
        const { controller, percentage, progressBar, rosette, summary } = createController ();

        controller.render ( { percentage: 0, total: 0, unlocked: 0 } );

        expect ( summary.textContent ).toBe ( 'This game has no Steam achievements.' );
        expect ( percentage.hidden ).toBe ( true );
        expect ( progressBar.hidden ).toBe ( true );
        expect ( progressBar.getAttribute ( 'value' ) ).toBeNull ();
        expect ( progressBar.getAttribute ( 'aria-valuetext' ) ).toBeNull ();
        expect ( rosette.getAttribute ( 'hidden' ) ).toBe ( '' );
    } );

    it ( 'shows a zeroed progress bar before a game is selected', () =>
    {
        const { controller, percentage, progressBar, region, rosette, summary } = createController ();

        controller.renderNoGameSelected ();

        expect ( summary.textContent ).toBe ( 'Achievements unlocked' );
        expect ( percentage.hidden ).toBe ( false );
        expect ( percentage.textContent ).toBe ( '0 %' );
        expect ( progressBar.hidden ).toBe ( false );
        expect ( progressBar.value ).toBe ( 0 );
        expect ( progressBar.max ).toBe ( 100 );
        expect ( progressBar.getAttribute ( 'aria-valuetext' ) ).toBe ( '0% achievements unlocked' );
        expect ( region.getAttribute ( 'aria-busy' ) ).toBe ( 'false' );
        expect ( region.getAttribute ( 'data-progress-complete' ) ).toBe ( 'false' );
        expect ( rosette.getAttribute ( 'hidden' ) ).toBe ( '' );
    } );

    it ( 'uses an indeterminate native bar and busy region while progress loads', () =>
    {
        const { controller, percentage, progressBar, region, rosette, summary } = createController ();

        controller.render ( { percentage: 100, total: 2, unlocked: 2 } );
        controller.renderLoading ( 'Loading achievement progress for Portal 2…' );

        expect ( summary.textContent ).toBe ( 'Loading achievement progress for Portal 2…' );
        expect ( percentage.hidden ).toBe ( true );
        expect ( progressBar.hidden ).toBe ( false );
        expect ( progressBar.getAttribute ( 'value' ) ).toBeNull ();
        expect ( progressBar.getAttribute ( 'aria-valuetext' ) ).toBeNull ();
        expect ( region.getAttribute ( 'aria-busy' ) ).toBe ( 'true' );
        expect ( rosette.getAttribute ( 'hidden' ) ).toBe ( '' );
    } );

    it ( 'ships a labelled native progress element with no captured progress-image dependency', () =>
    {
        const indexHtml = readFileSync ( new URL ( '../public/index.html', import.meta.url ), 'utf8' );

        expect ( indexHtml ).toContain ( '<progress class="achievement-progress__bar"' );
        expect ( indexHtml ).toContain ( '<svg class="achievement-progress__rosette"' );
        expect ( indexHtml ).toContain ( 'id="achievement-progress-percentage"' );
        expect ( indexHtml ).toContain ( 'aria-labelledby="achievement-progress-summary"' );
        expect ( indexHtml ).toContain ( 'aria-label="Achievement progress"' );
        expect ( indexHtml ).not.toContain ( '>★<' );
        expect ( indexHtml ).not.toContain ( 'achievements-unlocked.png' );
    } );
} );
