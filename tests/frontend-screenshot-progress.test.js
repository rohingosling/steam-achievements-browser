//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-04
// Author:  Rohin Gosling
//
// Description:
//
//   Verifies the accessible modal lifecycle and honest stage values used while screenshot generation is in progress.
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { createScreenshotProgressController } from '../public/js/screenshot-progress-view.js';

//---------------------------------------------------------------------------------------------------------------------
// Function: createFakeElement
//
// Description:
//
//   Creates the small attribute, text, and focus surface required by the progress controller.
//
// Returns:
//
//   A fake element suitable for one controller test.
//
//---------------------------------------------------------------------------------------------------------------------

function createFakeElement ()
{
    const attributes = new Map ();

    return (
        {
            attributes,
            focus: vi.fn (),
            getAttribute: attributeName => attributes.get ( attributeName ) ?? null,
            isConnected: true,
            max:         0,
            setAttribute: ( attributeName, value ) => attributes.set ( attributeName, String ( value ) ),
            textContent: '',
            value:       0,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createFakeDialog
//
// Description:
//
//   Creates a native-dialog-shaped fake whose cancel listener can be exercised directly.
//
// Parameters:
//
// - activeElement (object):
//   The control that should regain focus when the dialog closes.
//
// Returns:
//
//   The fake dialog and a cancellation-event dispatcher.
//
//---------------------------------------------------------------------------------------------------------------------

function createFakeDialog ( activeElement )
{
    const dialog    = createFakeElement ();
    const listeners = new Map ();

    dialog.addEventListener = ( eventName, listener ) => listeners.set ( eventName, listener );
    dialog.close = vi.fn ( () =>
    {
        dialog.open = false;
    } );
    dialog.open          = false;
    dialog.ownerDocument = { activeElement };
    dialog.showModal     = vi.fn ( () =>
    {
        dialog.open = true;
    } );

    function dispatchCancel ()
    {
        const event = { preventDefault: vi.fn () };

        listeners.get ( 'cancel' )?.( event );

        return event;
    }

    return { dialog, dispatchCancel };
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createFixture
//
// Description:
//
//   Creates one complete progress controller with inspectable fake elements.
//
// Returns:
//
//   The controller and all fake view elements.
//
//---------------------------------------------------------------------------------------------------------------------

function createFixture ()
{
    const screenshotControl         = createFakeElement ();
    const { dialog, dispatchCancel } = createFakeDialog ( screenshotControl );
    const announcement              = createFakeElement ();
    const heading                   = createFakeElement ();
    const message                   = createFakeElement ();
    const progressBar               = createFakeElement ();
    const stage                     = createFakeElement ();
    const controller                = createScreenshotProgressController (
        {
            announcement,
            dialog,
            heading,
            message,
            progressBar,
            stage,
        },
    );

    return (
        {
            controller,
            announcement,
            dialog,
            dispatchCancel,
            heading,
            message,
            progressBar,
            screenshotControl,
            stage,
        }
    );
}

describe ( 'Screenshot progress view', () =>
{
    it ( 'opens once and renders workflow-stage progress', () =>
    {
        const fixture = createFixture ();

        fixture.controller.update (
            {
                message:     'Preparing screenshot layout…',
                stageNumber: 1,
                totalStages: 5,
            },
        );

        expect ( fixture.dialog.showModal ).toHaveBeenCalledOnce ();
        expect ( fixture.heading.focus ).toHaveBeenCalledWith ( { preventScroll: true } );
        expect ( fixture.stage.textContent ).toBe ( 'Stage 1 of 5' );
        expect ( fixture.message.textContent ).toBe ( 'Preparing screenshot layout…' );
        expect ( fixture.progressBar.max ).toBe ( 5 );
        expect ( fixture.progressBar.value ).toBe ( 0 );
        expect ( fixture.announcement.textContent ).toBe (
            'Stage 1 of 5: Preparing screenshot layout…',
        );
        expect ( fixture.progressBar.getAttribute ( 'aria-valuetext' ) ).toBe (
            'Stage 1 of 5: Preparing screenshot layout…',
        );

        fixture.controller.update (
            {
                message:     'Measuring screenshot layout…',
                stageNumber: 1,
                totalStages: 5,
            },
        );

        expect ( fixture.message.textContent ).toBe ( 'Measuring screenshot layout…' );
        expect ( fixture.announcement.textContent ).toBe (
            'Stage 1 of 5: Preparing screenshot layout…',
        );

        fixture.controller.update (
            {
                message:     'Rendering screenshot tile 2 of 4…',
                stageNumber: 3,
                totalStages: 5,
            },
        );

        expect ( fixture.dialog.showModal ).toHaveBeenCalledOnce ();
        expect ( fixture.stage.textContent ).toBe ( 'Stage 3 of 5' );
        expect ( fixture.message.textContent ).toBe ( 'Rendering screenshot tile 2 of 4…' );
        expect ( fixture.progressBar.value ).toBe ( 2 );
        expect ( fixture.announcement.textContent ).toBe (
            'Stage 3 of 5: Rendering screenshot tile 2 of 4…',
        );

        fixture.controller.update (
            {
                message:       'Encoded screenshot PNG.',
                stageComplete: true,
                stageNumber:   3,
                totalStages:   5,
            },
        );

        expect ( fixture.progressBar.value ).toBe ( 3 );
        expect ( fixture.announcement.textContent ).toBe (
            'Stage 3 of 5: Rendering screenshot tile 2 of 4…',
        );
    } );

    it ( 'prevents premature Escape dismissal and restores focus exactly once', () =>
    {
        const fixture = createFixture ();

        fixture.controller.update (
            {
                message:     'Preparing screenshot images…',
                stageNumber: 2,
                totalStages: 5,
            },
        );

        const busyCancelEvent = fixture.dispatchCancel ();

        expect ( busyCancelEvent.preventDefault ).toHaveBeenCalledOnce ();

        fixture.controller.close ();
        fixture.controller.close ();

        expect ( fixture.dialog.close ).toHaveBeenCalledOnce ();
        expect ( fixture.announcement.textContent ).toBe ( '' );
        expect ( fixture.screenshotControl.focus ).toHaveBeenCalledOnce ();
        expect ( fixture.screenshotControl.focus ).toHaveBeenCalledWith ( { preventScroll: true } );

        const idleCancelEvent = fixture.dispatchCancel ();

        expect ( idleCancelEvent.preventDefault ).not.toHaveBeenCalled ();
    } );

    it ( 'can reopen cleanly for a later screenshot export', () =>
    {
        const fixture = createFixture ();

        fixture.controller.update (
            {
                message:     'Saving screenshot…',
                stageNumber: 5,
                totalStages: 5,
            },
        );
        fixture.controller.close ();
        fixture.controller.update (
            {
                message:     'Preparing screenshot layout…',
                stageNumber: 1,
                totalStages: 5,
            },
        );

        expect ( fixture.dialog.showModal ).toHaveBeenCalledTimes ( 2 );
        expect ( fixture.progressBar.value ).toBe ( 0 );
    } );
} );
