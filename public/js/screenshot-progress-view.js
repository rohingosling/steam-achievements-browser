//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/screenshot-progress-view.js
//
// Description:
//   Accessible application progress for screenshot generation. The controller keeps the browser-specific capture
//   pipeline outside the view while presenting its structured stage reports through one native modal dialog.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: createScreenshotProgressController
//
// Description:
//
//   Creates the screenshot progress dialog controller and restores the invoking control when generation settles.
//
// Parameters:
//
// - elements (object):
//   The dialog, heading, stage label, native progress element, visual detail, and throttled live announcement.
//
// Returns:
//
//   The screenshot progress controller.
//
//---------------------------------------------------------------------------------------------------------------------

export function createScreenshotProgressController ( elements )
{
    const {
        announcement,
        dialog,
        heading,
        message,
        progressBar,
        stage,
    } = elements;

    let isScreenshotGenerationInProgress = false;
    let lastAnnouncedStageNumber         = null;
    let returnFocusElement               = null;

    //-----------------------------------------------------------------------------------------------------------------
    // Function: preventPrematureDismissal
    //
    // Description:
    //
    //   Keeps Escape from hiding progress while bounded screenshot work continues without an end-to-end cancel path.
    //
    // Parameters:
    //
    // - event (Event):
    //   The native dialog cancellation request.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function preventPrematureDismissal ( event )
    {
        if ( isScreenshotGenerationInProgress )
        {
            event.preventDefault ();
        }
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: open
    //
    // Description:
    //
    //   Opens the native modal once and moves focus to its stable heading.
    //
    // Parameters:
    //
    // - focusElement (HTMLElement or null):
    //   The invoking control that should regain focus when generation settles.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function open ( focusElement )
    {
        isScreenshotGenerationInProgress = true;

        if ( dialog.open )
        {
            return;
        }

        returnFocusElement = focusElement ?? dialog.ownerDocument?.activeElement ?? null;

        dialog.showModal ();

        try
        {
            heading.focus ( { preventScroll: true } );
        }
        catch
        {
            // Focus feedback is helpful but must never interrupt the bounded screenshot pipeline.
        }
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: update
    //
    // Description:
    //
    //   Displays one structured generation stage. The bar records completed stages rather than inventing an elapsed
    //   time or byte percentage, while the text identifies the stage currently in progress.
    //
    // Parameters:
    //
    // - report (object):
    //   The current human-readable message, stage number, and total stage count.
    //
    // - focusElement (HTMLElement or null):
    //   The invoking control that should regain focus when generation settles.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function update ( report, focusElement = null )
    {
        const totalStages = Math.max ( 1, Number.parseInt ( report.totalStages, 10 ) || 1 );
        const stageNumber = Math.min (
            totalStages,
            Math.max ( 1, Number.parseInt ( report.stageNumber, 10 ) || 1 ),
        );
        const completedStageCount = report.stageComplete === true
            ? stageNumber
            : stageNumber - 1;

        stage.textContent   = `Stage ${stageNumber} of ${totalStages}`;
        message.textContent = report.message;
        progressBar.max     = totalStages;
        progressBar.value   = completedStageCount;
        progressBar.setAttribute (
            'aria-valuetext',
            `Stage ${stageNumber} of ${totalStages}: ${report.message}`,
        );

        if ( lastAnnouncedStageNumber !== stageNumber )
        {
            announcement.textContent   = `Stage ${stageNumber} of ${totalStages}: ${report.message}`;
            lastAnnouncedStageNumber   = stageNumber;
        }

        open ( focusElement );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: close
    //
    // Description:
    //
    //   Closes the modal idempotently and returns focus to the invoking control when it remains available.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function close ()
    {
        const focusElement = returnFocusElement;

        isScreenshotGenerationInProgress = false;
        returnFocusElement               = null;

        if ( dialog.open )
        {
            try
            {
                dialog.close ();
            }
            catch
            {
                // View cleanup must not retain the application's screenshot busy guard.
            }
        }

        announcement.textContent = '';
        lastAnnouncedStageNumber = null;

        if (
            focusElement !== null
            && focusElement.isConnected !== false
            && typeof focusElement.focus === 'function'
        )
        {
            try
            {
                focusElement.focus ( { preventScroll: true } );
            }
            catch
            {
                // A removed or disabled invoking control does not affect screenshot completion.
            }
        }
    }

    dialog.addEventListener ( 'cancel', preventPrematureDismissal );

    return (
        {
            close,
            update,
        }
    );
}
